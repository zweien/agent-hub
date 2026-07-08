"""对话路由(本轮非流式;流式 WebSocket 留 §10 第5步)。

POST /chat:接收用户消息,调气动 agent,返回回复。
本轮无状态单 agent(无 session_id/记忆)。
"""
from __future__ import annotations

import logging
import time

from fastapi import APIRouter, HTTPException

from app.models.schemas import ChatRequest, ChatResponse
from app.agent_runtime.aero_agent import run as run_agent

logger = logging.getLogger("api.chat")
router = APIRouter(tags=["chat"])


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    t0 = time.time()
    try:
        reply = run_agent(req.message, session_id=req.session_id or "")
    except ValueError as e:
        # 配置缺失等
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.exception("agent 运行失败")
        raise HTTPException(status_code=502, detail=f"agent 错误: {e}")
    return ChatResponse(reply=reply, elapsed_ms=int((time.time() - t0) * 1000))
