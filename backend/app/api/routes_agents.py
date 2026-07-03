"""Agent 配置路由(§8 配置面)。

- GET /agents:所有已发布配置(user 可读)
- GET /agents/{id}:单个详情
- POST /agents:创建(仅 builder/admin)
- PUT /agents/{id}:编辑(仅 owner 且 builder/admin)
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user, require_role
from app.db import SessionLocal
from app.models.agent_config import AgentConfig

router = APIRouter(prefix="/agents", tags=["agents"])


class AgentConfigRequest(BaseModel):
    name: str
    system_prompt: str
    tools: list[str] = []
    skill_ids: list[str] = []   # 引用的能力包(§4.6),会话启动时同步进容器
    model: str = "deepseek-v4-flash"
    mode: str = "standard"
    is_published: bool = False


@router.get("")
async def list_agents(user: dict = Depends(get_current_user)):
    """列表:user 看所有已发布;builder/admin 看全部(含自己的草稿)。"""
    db = SessionLocal()
    try:
        q = db.query(AgentConfig)
        if user["role"] == "user":
            q = q.filter(AgentConfig.is_published == True)
        rows = q.order_by(AgentConfig.created_at.desc()).all()
        return [r.to_dict() for r in rows]
    finally:
        db.close()


@router.get("/{agent_id}")
async def get_agent(agent_id: str, user: dict = Depends(get_current_user)):
    db = SessionLocal()
    try:
        cfg = db.get(AgentConfig, agent_id)
        if not cfg:
            raise HTTPException(404, "配置不存在")
        if user["role"] == "user" and not cfg.is_published:
            raise HTTPException(403, "无权查看未发布配置")
        return cfg.to_dict()
    finally:
        db.close()


@router.post("")
async def create_agent(req: AgentConfigRequest, user: dict = Depends(require_role("builder", "admin"))):
    db = SessionLocal()
    try:
        cfg = AgentConfig(
            name=req.name, system_prompt=req.system_prompt, tools=req.tools,
            skill_ids=req.skill_ids, model=req.model, mode=req.mode,
            owner_id=user["username"], is_published=req.is_published,
        )
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
        return cfg.to_dict()
    finally:
        db.close()


@router.put("/{agent_id}")
async def update_agent(agent_id: str, req: AgentConfigRequest, user: dict = Depends(require_role("builder", "admin"))):
    db = SessionLocal()
    try:
        cfg = db.get(AgentConfig, agent_id)
        if not cfg:
            raise HTTPException(404, "配置不存在")
        if cfg.owner_id != user["username"] and user["role"] != "admin":
            raise HTTPException(403, "只能编辑自己的配置")
        cfg.name = req.name
        cfg.system_prompt = req.system_prompt
        cfg.tools = req.tools
        cfg.skill_ids = req.skill_ids
        cfg.model = req.model
        cfg.mode = req.mode
        cfg.is_published = req.is_published
        db.commit()
        return cfg.to_dict()
    finally:
        db.close()
