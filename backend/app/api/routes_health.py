"""健康检查路由。"""
from __future__ import annotations

from fastapi import APIRouter

from app.config import get_settings
from app.models.schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """返回脱敏配置摘要,供运维/前端探活。"""
    return HealthResponse(status="ok", config=get_settings().summary())
