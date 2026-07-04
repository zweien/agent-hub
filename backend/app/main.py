"""Agent Hub V1 后端入口。

模块化单体(§2.2):FastAPI 实例 + 挂载各模块路由。
本轮:health + chat(调气动 agent)。
"""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.api.routes_health import router as health_router
from app.api.routes_chat import router as chat_router
from app.api.routes_ws import router as ws_router
from app.api.routes_auth import router as auth_router
from app.api.routes_agents import router as agents_router
from app.api.routes_skills import router as skills_router
from app.api.routes_tools import router as tools_router
from app.api.routes_sandboxes import router as sandboxes_router
from app.api.routes_sandbox_templates import router as sandbox_templates_router
from app.api.routes_sessions import router as sessions_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("app")

settings = get_settings()

app = FastAPI(title=settings.app_name, version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(agents_router)
app.include_router(skills_router)
app.include_router(tools_router)
app.include_router(sandboxes_router)
app.include_router(sandbox_templates_router)
app.include_router(sessions_router)
app.include_router(chat_router)
app.include_router(ws_router)


@app.on_event("startup")
async def startup() -> None:
    # 建表(§2.5 事件流 + 会话 + skill;本轮用 create_all,不用 Alembic)
    from app.db import init_db
    init_db()
    # A2:启动空闲容器回收 reaper(每 60s 扫,>30min 回收)
    import asyncio
    from app.agent_runtime.session_runner import registry

    async def _reaper():
        while True:
            await asyncio.sleep(60)
            try:
                await registry.reap_idle_sessions(max_idle_s=1800)
            except Exception:
                logger.warning("reaper 异常", exc_info=True)

    asyncio.create_task(_reaper())
    logger.info("Agent Hub 启动 | 模型=%s | sandbox=会话级容器 | DB 建表完成", settings.llm_model)


@app.get("/")
async def root() -> dict:
    return {"name": settings.app_name, "docs": "/docs", "health": "/health"}
