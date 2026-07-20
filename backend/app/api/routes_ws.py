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


def _create_session_in_db(session_id: str, title: str | None = None, owner_id: str | None = None, agent_config_id: str | None = None):
    db = SessionLocal()
    try:
        if not db.get(Session, session_id):
            db.add(Session(id=session_id, status="running", title=title, owner_id=owner_id, agent_config_id=agent_config_id))
            db.commit()
    finally:
        db.close()


@router.websocket("/ws/chat")
async def chat_ws(
    ws: WebSocket,
    session_id: str | None = Query(default=None),
    token: str | None = Query(default=None),
):
    """流式对话 WS。会话独立于连接(§2.4)。token 鉴权(§7)。"""
    # WS 鉴权(§7):校验 token
    from app.auth import verify_token
    try:
        current_user = verify_token(token) if token else {"username": None, "role": "user"}
    except Exception:
        await ws.accept()
        await ws.send_json({"type": "error", "message": "未授权(token 无效)"})
        await ws.close()
        return
    await ws.accept()
    current_sid = session_id
    logger.info("WS 连接 user=%s session_id=%s", current_user.get("username"), current_sid or "(新建)")

    # 重连:回放历史(提高上限,避免长会话刷新丢早期事件)
    if current_sid:
        history = registry.get_history(current_sid, limit=1000)
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
            if msg_type in ("set_mode", "set_model", "set_tools"):
                # 控制消息需先有会话(§8):无 session 时回 control_ack 提示前端,
                # 避免前端无回执以为已生效(隐性 bug)。首条消息后会话建立,再发即生效。
                if not current_sid:
                    await ws.send_json({"type": "control_ack", "ok": False,
                                        "message": f"{msg_type} 需先发送一条消息建立会话,已缓存到本地;首条消息后重新选择"})
                    continue
                if msg_type == "set_mode":
                    registry.set_mode(current_sid, msg.get("mode", "standard"))
                elif msg_type == "set_model":
                    registry.set_model(current_sid, msg.get("model", ""))
                else:
                    registry.set_tools(current_sid, msg.get("tools", []))
                await ws.send_json({"type": "control_ack", "ok": True, "message": msg_type})
                continue
            if msg_type == "cancel":
                if not current_sid:
                    await ws.send_json({"type": "control_ack", "ok": False, "message": "无活跃会话"})
                    continue
                registry.cancel(current_sid)
                continue

            # —— 控制消息:失败恢复(§5.5)——
            if msg_type == "recover":
                if not current_sid:
                    continue
                await registry.recover(current_sid, msg.get("action", "end"))
                continue

            # —— 控制消息:HITL 恢复(canvas-2)——
            if msg_type == "resume":
                if not current_sid:
                    continue
                await registry.resume_interrupt(current_sid, msg.get("value", ""))
                continue

            # —— 普通对话消息 ——
            user_input = msg.get("message", "").strip()
            if not user_input:
                continue

            if not current_sid:
                current_sid = _new_sid()
                # 首条消息可带 agent_config_id(§8 对话选配置);记到 session
                cfg_id = msg.get("agent_config_id")
                _create_session_in_db(
                    current_sid, title=user_input[:40],
                    owner_id=current_user.get("username"),
                    agent_config_id=cfg_id or None,
                )
                await ws.send_json({"type": "session_started", "session_id": current_sid})
                sub_queue = registry.subscribe(current_sid)
                pump_task = asyncio.create_task(_pump())
                # 新会话首条消息:把配置 id 记进 SessionState(供 start_session 读 prompt/tools/model)
                if cfg_id:
                    state = registry._get_or_create(current_sid)
                    state.__dict__["agent_config_id"] = cfg_id

            # 启动 agent task(后台,独立于 WS)
            # 续同一会话的后续消息:若本次带了新的 agent_config_id 则覆盖
            cfg_id = msg.get("agent_config_id")
            await registry.start_session(current_sid, user_input, agent_config_id=cfg_id or "")
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
