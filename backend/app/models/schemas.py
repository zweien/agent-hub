"""最小 API schema(本轮脚手架)。

事件流/会话/agent 配置等数据模型留后续步骤(§2.5 事件流、§4 agent 配置)。
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    """GET /health 响应。"""
    status: str = Field(default="ok")
    config: dict = Field(default_factory=dict, description="脱敏配置摘要")


class ChatRequest(BaseModel):
    """POST /chat 请求。"""
    message: str = Field(..., min_length=1, description="用户消息")
    # 后续可加 session_id / agent_id(本轮简化为无状态单 agent)


class ChatResponse(BaseModel):
    """POST /chat 响应。"""
    reply: str = Field(..., description="agent 回复")
    elapsed_ms: int = Field(..., description="耗时(毫秒)")
