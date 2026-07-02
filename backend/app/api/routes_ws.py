"""WebSocket 流式对话路由(§2.3 + §2.4 会话独立 + §2.5 事件流 + 接管 C1)。

会话独立于连接:agent 在后台 task 跑,WS 是观察者。
并发模型:pump task 持续推事件,主循环收消息处理(建 session/接管),
  二者并行——避免 pump 阻塞时收不到 takeover_end 等控制消息。

事件协议(后端→前端):
  {"type":"replay","events":[...]}           重连历史回放
  {"type":"session_started","session_id":"..."}
  {"type":"token","content":"..."}           LLM token 增量
  {"type":"tool_start/tool_end",...}
  {"type":"takeover_ready","sandbox_url":"..."} 接管就绪(§2.3 C1)
  {"type":"takeover_begin/takeover_end"}     接管事件(也进事件流)
  {"type":"done"} / {"type":"error","message":"..."}

控制消息(前端→后端):
  {"type":"takeover_begin"} / {"type":"takeover_end"}
  {"message":"..."}                          普通对话
"""
from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from app.db import SessionLocal
from app.models.session import Session, _new_sid
from app.agent_runtime.session_runner import registry

logger = logging.getLogger("api.ws")
router = APIRouter()


def _create_session_in_db(session_id: str, title: str | None = None):
    db = SessionLocal()
    try:
        if not db.get(Session, session_id):
            db.add(Session(id=session_id, status="running", title=title))
            db.commit()
    finally:
        db.close()


@router.websocket("/ws/chat")
async def chat_ws(ws: WebSocket, session_id: str | None = Query(default=None)):
    """流式对话 WS。会话独立于连接(§2.4)。并发:pump + 收消息。"""
    await ws.accept()
    current_sid = session_id
    logger.info("WS 连接 session_id=%s", current_sid or "(新建)")

    # 重连:回放历史
    if current_sid:
        history = registry.get_history(current_sid)
        if history:
            await ws.send_json({"type": "replay", "events": history})

    sub_queue: asyncio.Queue | None = registry.subscribe(current_sid) if current_sid else None
    pump_task: asyncio.Task | None = None
    stop_pump = asyncio.Event()

    async def _pump():
        """持续把订阅事件推给 WS,直到 stop_pump 或连接断。"""
        if sub_queue is None:
            return
        while not stop_pump.is_set():
            try:
                event = await asyncio.wait_for(sub_queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            await ws.send_json(event)

    if sub_queue:
        pump_task = asyncio.create_task(_pump())

    try:
        while True:
            data = await ws.receive_text()
            try:
                msg = json.loads(data)
            except json.JSONDecodeError:
                await ws.send_json({"type": "error", "message": "请求需为 JSON"})
                continue

            msg_type = msg.get("type")

            # —— 控制消息:接管(§2.3 C1)——
            if msg_type == "takeover_begin":
                if not current_sid:
                    await ws.send_json({"type": "error", "message": "无活跃会话,无法接管"})
                    continue
                info = registry.request_takeover(current_sid)
                await ws.send_json({"type": "takeover_ready", "sandbox_url": info["sandbox_url"]})
                continue
            if msg_type == "takeover_end":
                if not current_sid:
                    continue
                registry.end_takeover(current_sid)
                continue

            # —— 控制消息:工具确认(§5.4)——
            if msg_type == "confirm":
                if not current_sid:
                    continue
                registry.resolve_confirm(
                    current_sid, msg.get("action_id", ""),
                    approved=msg.get("approved", False),
                    args=msg.get("args"),
                )
                continue
            if msg_type == "set_mode":
                if not current_sid:
                    continue
                registry.set_mode(current_sid, msg.get("mode", "standard"))
                continue

            # —— 控制消息:失败恢复(§5.5)——
            if msg_type == "recover":
                if not current_sid:
                    continue
                await registry.recover(current_sid, msg.get("action", "end"))
                continue

            # —— 普通对话消息 ——
            user_input = msg.get("message", "").strip()
            if not user_input:
                continue

            if not current_sid:
                current_sid = _new_sid()
                _create_session_in_db(current_sid, title=user_input[:40])
                await ws.send_json({"type": "session_started", "session_id": current_sid})
                sub_queue = registry.subscribe(current_sid)
                pump_task = asyncio.create_task(_pump())

            # 启动 agent task(后台,独立于 WS)
            await registry.start_session(current_sid, user_input)
            # 事件由 _pump 持续推送,主循环继续收消息(含 takeover)
    except WebSocketDisconnect:
        logger.info("WS 断开 session=%s(agent task 继续)", current_sid)
    except Exception as e:
        logger.exception("WS 错误")
        try:
            await ws.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        stop_pump.set()
        if pump_task and not pump_task.done():
            pump_task.cancel()
        if current_sid and sub_queue:
            registry.unsubscribe(current_sid, sub_queue)
