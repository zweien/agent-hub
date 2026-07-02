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
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from app.db import SessionLocal
from app.models.event import Event
from app.models.session import Session
from app.agent_runtime.aero_agent import astream_agent
from app.agent_runtime.guardrails import Mode, Limits

logger = logging.getLogger("session_runner")

# 每个订阅者一个 Queue;agent 每产一个事件 → 写 DB + put 到所有订阅者
_SUBSCRIBER_MAX_QUEUE = 500

# 当前 session:模块级全局(LangGraph 工具执行跨 task/contextvar 边界,
# 故用进程级变量。V1 单进程、并发低(决策#19),可接受;多会话并发留 V2)。
# start_session._run 里 set,工具 wrapper 里 get。
_current_session_state: "SessionState | None" = None


def get_current_session() -> "SessionState | None":
    """工具 wrapper 调用:取当前 session(§5.4 工具确认)。进程级,非线程安全。"""
    return _current_session_state


@dataclass
class SessionState:
    """运行中的会话状态(进程内)。"""
    session_id: str
    task: asyncio.Task | None = None
    subscribers: list[asyncio.Queue] = field(default_factory=list)
    next_seq: int = 0
    # 接管门控(§2.3 C1):set 时 agent 可继续,clear 时 agent 在下一事件边界挂起
    resume_event: asyncio.Event = field(default_factory=asyncio.Event)
    # —— 运行时防护(§5.4)——
    mode: Mode = Mode.STANDARD
    limits: Limits = field(default_factory=lambda: Limits.for_mode(Mode.STANDARD))
    round_count: int = 0
    tool_call_count: int = 0
    started_at: float = field(default_factory=time.time)
    # 工具确认的决策通道:工具 wrapper put 请求、await 结果;WS confirm 写结果
    pending_decision: dict | None = None  # {"action_id","tool","args"}
    decision_result: asyncio.Queue = field(default_factory=asyncio.Queue)
    # 失败恢复(§5.5):记录上一轮用户输入,失败后 retry 用
    last_user_input: str = ""


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
        """启动 agent 执行(后台 async task,独立于 WS)。

        每次(含 retry)重置防护计数 + 记录 last_user_input(§5.5 失败重试用)。
        """
        state = self._get_or_create(session_id)
        state.last_user_input = user_input
        state.started_at = time.time()   # 重置超时计时
        state.round_count = 0            # 重置熔断计数
        state.tool_call_count = 0
        state.resume_event.set()
        if state.task and not state.task.done():
            logger.warning("session %s 已有运行中的 task", session_id)

        async def _run():
            # set 进程级当前 session(工具 wrapper 经 get_current_session 查)
            global _current_session_state
            _current_session_state = state
            try:
                # 记录用户消息事件
                self._persist_event(session_id, state,
                                    {"type": "message_in", "content": user_input}, actor="user")
                async for event in astream_agent(user_input):
                    # 接管门控(§2.3 C1):被 clear 时在此挂起,直到交还(set)
                    await state.resume_event.wait()
                    # 熔断计数(§5.4):token 不计入轮数;tool_start 才算一轮
                    if event.get("type") == "tool_start":
                        state.tool_call_count += 1
                        state.round_count += 1
                    reason = self._check_limits(state)
                    if reason:
                        self._persist_event(session_id, state,
                                            {"type": "interrupted", "reason": reason}, actor="system")
                        logger.warning("熔断 session=%s reason=%s", session_id, reason)
                        return
                    self._persist_event(session_id, state, event, actor="agent")
            except Exception as e:
                # §5.5 失败暂停态:不写 error(结束),改写 interrupted(等用户决策)
                logger.exception("agent task 异常 session=%s(进 interrupted,等 recover)", session_id)
                self._persist_event(session_id, state,
                                    {"type": "interrupted", "reason": f"执行异常: {type(e).__name__}: {str(e)[:200]}"},
                                    actor="system")
            finally:
                _current_session_state = None

        state.task = asyncio.create_task(_run())
        logger.info("启动 session %s 的 agent task", session_id)

    def _check_limits(self, state: SessionState) -> str | None:
        """熔断检查:超限返回原因,否则 None。"""
        if state.round_count > state.limits.max_rounds:
            return f"超过最大轮数 {state.limits.max_rounds}"
        if state.tool_call_count > state.limits.max_tool_calls:
            return f"超过最大工具调用次数 {state.limits.max_tool_calls}"
        if time.time() - state.started_at > state.limits.timeout_s:
            return f"超过总执行超时 {state.limits.timeout_s}s"
        return None

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

    # —— 工具前置确认(§5.4)——
    async def request_confirm(self, session_id: str, tool: str, args: dict) -> dict:
        """工具 wrapper 调用:请求用户确认,阻塞等待决策结果。

        返回 {"approved": bool, "args": dict}(args 可能被用户修改)。
        agent task 在此 await 暂停(工具 wrapper 内),WS 写 resolve_confirm 唤醒。
        """
        state = self._get_or_create(session_id)
        action_id = "act_" + uuid.uuid4().hex[:12]
        state.pending_decision = {"action_id": action_id, "tool": tool, "args": args}
        # 推 action_required 给订阅者(前端弹确认)
        self._persist_event(session_id, state,
                            {"type": "action_required", "action_id": action_id, "tool": tool, "args": args},
                            actor="system")
        # 阻塞等 WS 的 resolve_confirm 写结果
        result = await state.decision_result.get()
        state.pending_decision = None
        return result

    def resolve_confirm(self, session_id: str, action_id: str, approved: bool, args: dict | None = None):
        """WS 收到 confirm 消息时调用:写决策结果,唤醒等待的 agent。"""
        state = self._get_or_create(session_id)
        self._persist_event(session_id, state,
                            {"type": "action_resolved", "action_id": action_id, "approved": approved},
                            actor="user")
        state.decision_result.put_nowait({"approved": approved, "args": args or state.pending_decision.get("args", {}) if state.pending_decision else {}})
        logger.info("工具确认 session=%s action=%s approved=%s", session_id, action_id, approved)

    def set_mode(self, session_id: str, mode_str: str):
        """切换会话防护模式(§5.4 三模式)。"""
        state = self._get_or_create(session_id)
        state.mode = Mode.parse(mode_str)
        state.limits = Limits.for_mode(state.mode)
        self._persist_event(session_id, state,
                            {"type": "mode_changed", "mode": state.mode.value}, actor="user")
        logger.info("模式切换 session=%s → %s", session_id, state.mode.value)

    # —— 失败恢复(§5.5)——
    async def request_failure_pause(self, session_id: str, tool: str, reason: str) -> dict:
        """工具失败时调用(§5.5):写 interrupted + 暂停等用户 recover 决策。

        复用 decision_result 通道(与工具确认同机制,决策#20)。
        返回 {"action": "retry|skip|end"}(takeover 由 WS 单独处理)。
        """
        state = self._get_or_create(session_id)
        action_id = "fail_" + uuid.uuid4().hex[:12]
        state.pending_decision = {"action_id": action_id, "tool": tool, "reason": reason}
        self._persist_event(session_id, state,
                            {"type": "interrupted", "reason": f"工具 {tool} 失败: {reason}",
                             "action_id": action_id, "options": ["retry", "skip", "takeover", "end"]},
                            actor="system")
        # 阻塞等 WS 的 recover 写结果
        result = await state.decision_result.get()
        state.pending_decision = None
        return result

    async def recover(self, session_id: str, action: str):
        """失败后用户决策:retry/takeover/skip/end(§5.5)。

        若有工具正在等失败决策(request_failure_pause 阻塞中),put 到 decision_result 唤醒它;
        若 task 已结束(熔断/顶层异常),直接执行恢复动作。
        """
        state = self._get_or_create(session_id)
        # 写恢复决策事件
        self._persist_event(session_id, state,
                            {"type": "recover", "action": action}, actor="user")
        # 如果工具在等失败决策 → 唤醒它(工具内处理 retry/skip/end)
        if state.pending_decision and state.pending_decision.get("action_id", "").startswith("fail_"):
            state.decision_result.put_nowait({"action": action})
            logger.info("失败恢复(工具内) session=%s action=%s", session_id, action)
            return
        # task 已结束的情况 → 直接恢复
        if action == "end":
            self._persist_event(session_id, state, {"type": "done"}, actor="system")
            logger.info("失败恢复:结束 session=%s", session_id)
        elif action == "retry":
            logger.info("失败恢复:重试 session=%s", session_id)
            await self.start_session(session_id, state.last_user_input)
        elif action == "skip":
            logger.info("失败恢复:跳过 session=%s", session_id)
            await self.start_session(session_id, "上一步失败已跳过,请继续给出建议。")
        elif action == "takeover":
            self._update_session_status(session_id, "human_takeover")
            self._persist_event(session_id, state, {"type": "takeover_begin"}, actor="user")
            logger.info("失败恢复:接管 session=%s", session_id)
        else:
            logger.warning("未知 recover action=%s session=%s", action, session_id)

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
