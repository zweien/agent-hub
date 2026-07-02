"""会话执行模型(§2.4 会话独立于连接 + §2.5 事件流)。

核心:agent 在后台 asyncio task 执行,独立于任何 WS 连接。
  - 事件 append 写 DB(§2.5 唯一事实来源)
  - 订阅者(asyncio.Queue)实时收到新事件(WS 观察者)
  - WS 断开不影响 agent task;重连从 DB 重放历史 + 重新订阅

单进程实现(决策#19:V1 不上 Celery)。
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field

from app.db import SessionLocal
from app.models.event import Event
from app.models.session import Session
from app.agent_runtime.aero_agent import astream_agent

logger = logging.getLogger("session_runner")

# 每个订阅者一个 Queue;agent 每产一个事件 → 写 DB + put 到所有订阅者
_SUBSCRIBER_MAX_QUEUE = 500


@dataclass
class SessionState:
    """运行中的会话状态(进程内)。"""
    session_id: str
    task: asyncio.Task | None = None
    subscribers: list[asyncio.Queue] = field(default_factory=list)
    next_seq: int = 0
    # 接管门控(§2.3 C1):set 时 agent 可继续,clear 时 agent 在下一事件边界挂起
    resume_event: asyncio.Event = field(default_factory=asyncio.Event)


class SessionRegistry:
    """进程内会话注册表(单例)。"""

    def __init__(self):
        self._sessions: dict[str, SessionState] = {}

    def _get_or_create(self, session_id: str) -> SessionState:
        if session_id not in self._sessions:
            st = SessionState(session_id=session_id)
            st.resume_event.set()  # 初始:agent 可运行(非挂起)
            self._sessions[session_id] = st
        return self._sessions[session_id]

    def subscribe(self, session_id: str) -> asyncio.Queue:
        """订阅某会话的新事件(WS 连接用)。返回 Queue,读取可获推送。"""
        state = self._get_or_create(session_id)
        q: asyncio.Queue = asyncio.Queue(maxsize=_SUBSCRIBER_MAX_QUEUE)
        state.subscribers.append(q)
        logger.info("订阅 session %s (当前订阅者 %d)", session_id, len(state.subscribers))
        return q

    def unsubscribe(self, session_id: str, q: asyncio.Queue):
        """取消订阅(WS 断开时)。agent task 不受影响。"""
        state = self._sessions.get(session_id)
        if state and q in state.subscribers:
            state.subscribers.remove(q)
            logger.info("取消订阅 session %s (剩余订阅者 %d)", session_id, len(state.subscribers))

    def _persist_event(self, session_id: str, state: SessionState, event: dict, actor: str = "agent"):
        """写 DB(append-only)+ 推送给订阅者。"""
        state.next_seq += 1
        db = SessionLocal()
        try:
            db.add(Event(
                session_id=session_id, seq=state.next_seq,
                type=event.get("type", "?"), payload=event, actor=actor,
            ))
            # 同步更新 session 状态
            sess = db.get(Session, session_id)
            if sess:
                if event["type"] == "done":
                    sess.status = "done"
                elif event["type"] == "error":
                    sess.status = "interrupted"
                else:
                    sess.status = "running"
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("写事件失败 session=%s", session_id)
        finally:
            db.close()
        # 推送给订阅者(非阻塞,满了丢弃防阻塞 agent)
        for q in list(state.subscribers):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning("订阅者队列满,丢弃事件 session=%s", session_id)

    async def start_session(self, session_id: str, user_input: str):
        """启动 agent 执行(后台 async task,独立于 WS)。"""
        state = self._get_or_create(session_id)
        if state.task and not state.task.done():
            logger.warning("session %s 已有运行中的 task", session_id)

        async def _run():
            try:
                # 记录用户消息事件
                self._persist_event(session_id, state,
                                    {"type": "message_in", "content": user_input}, actor="user")
                async for event in astream_agent(user_input):
                    # 接管门控(§2.3 C1):被 clear 时在此挂起,直到交还(set)
                    await state.resume_event.wait()
                    self._persist_event(session_id, state, event, actor="agent")
            except Exception as e:
                logger.exception("agent task 异常 session=%s", session_id)
                self._persist_event(session_id, state, {"type": "error", "message": str(e)})

        state.task = asyncio.create_task(_run())
        logger.info("启动 session %s 的 agent task", session_id)

    def request_takeover(self, session_id: str) -> dict:
        """请求接管(§2.3 C1):挂起 agent,返回 sandbox 工作环境 URL。"""
        state = self._get_or_create(session_id)
        state.resume_event.clear()  # 挂起:agent 在下一事件边界暂停
        from app.config import get_settings
        sandbox_url = get_settings().sandbox_public_url
        self._update_session_status(session_id, "human_takeover")
        self._persist_event(session_id, state, {"type": "takeover_begin"}, actor="user")
        logger.info("接管开始 session=%s(agent 挂起)", session_id)
        return {"sandbox_url": sandbox_url}

    def end_takeover(self, session_id: str):
        """结束接管(交还):恢复 agent。"""
        state = self._get_or_create(session_id)
        state.resume_event.set()  # 恢复:agent 继续
        self._update_session_status(session_id, "running")
        self._persist_event(session_id, state, {"type": "takeover_end"}, actor="user")
        logger.info("接管结束 session=%s(agent 恢复)", session_id)

    def _update_session_status(self, session_id: str, status: str):
        """更新 session 状态(私有)。"""
        db = SessionLocal()
        try:
            sess = db.get(Session, session_id)
            if sess:
                sess.status = status
                db.commit()
        finally:
            db.close()

    def get_history(self, session_id: str, limit: int = 100) -> list[dict]:
        """从 DB 读取会话历史事件(重连回放用)。"""
        db = SessionLocal()
        try:
            rows = (
                db.query(Event)
                .filter(Event.session_id == session_id)
                .order_by(Event.seq.desc())
                .limit(limit)
                .all()
            )
            return [r.to_dict() for r in reversed(rows)]
        finally:
            db.close()


# 进程单例
registry = SessionRegistry()
