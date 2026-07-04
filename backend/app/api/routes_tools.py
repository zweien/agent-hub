"""Tool 管理路由(统一工具管理,A 类配置/B 类只读)。

镜像 routes_skills.py 的 CRUD + 角色/owner 控制。
工具类型:python/bash(脚本,sandbox 跑)/ web(HTTP)/ mcp(MCP server)。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user, require_role
from app.db import SessionLocal
from app.models.tool import Tool, TOOL_TYPES

router = APIRouter(prefix="/tools", tags=["tools"])

# 内置工具声明(给前端列表统一展示,不存 DB)
_BUILTIN_SPECS = [
    {"id": "run_aero_tool", "name": "run_aero_tool", "description": "计算机翼气动特性(单次分析)。给定翼展/面积/迎角,返回 CL/CDi/L_D。",
     "type": "builtin", "config": {}, "params_schema": {}, "owner_id": "system", "is_published": True},
    {"id": "run_sweep_in_sandbox", "name": "run_sweep_in_sandbox", "description": "在沙箱跑展弦比参数扫描,找最大升阻比。",
     "type": "builtin", "config": {}, "params_schema": {}, "owner_id": "system", "is_published": True},
]


class ToolRequest(BaseModel):
    name: str
    description: str = ""
    type: str = "python"          # python/bash/web/mcp
    config: dict = {}             # type-specific
    params_schema: dict = {}      # 入参 JSON Schema(给 LLM)
    is_published: bool = False


@router.get("")
async def list_tools(user: dict = Depends(get_current_user)):
    """列表:user 看已发布 + 内置;builder/admin 看全部 + 内置。"""
    db = SessionLocal()
    try:
        q = db.query(Tool)
        if user["role"] == "user":
            q = q.filter(Tool.is_published == True)
        rows = q.order_by(Tool.created_at.desc()).all()
        user_tools = [r.to_dict() for r in rows]
    finally:
        db.close()
    # 内置工具前置
    return _BUILTIN_SPECS + user_tools


@router.get("/{tool_id}")
async def get_tool(tool_id: str, user: dict = Depends(get_current_user)):
    if tool_id in ("run_aero_tool", "run_sweep_in_sandbox"):
        return next(s for s in _BUILTIN_SPECS if s["id"] == tool_id)
    db = SessionLocal()
    try:
        t = db.get(Tool, tool_id)
        if not t:
            raise HTTPException(404, "工具不存在")
        if user["role"] == "user" and not t.is_published:
            raise HTTPException(403, "无权查看未发布工具")
        return t.to_dict()
    finally:
        db.close()


@router.post("")
async def create_tool(req: ToolRequest, user: dict = Depends(require_role("builder", "admin"))):
    if req.type not in TOOL_TYPES:
        raise HTTPException(400, f"type 必须是 {TOOL_TYPES}")
    db = SessionLocal()
    try:
        # 名字唯一 + 不与内置冲突
        if req.name in ("run_aero_tool", "run_sweep_in_sandbox"):
            raise HTTPException(400, "工具名与内置冲突")
        if db.query(Tool).filter(Tool.name == req.name).first():
            raise HTTPException(400, "工具名已存在")
        t = Tool(
            name=req.name, description=req.description, type=req.type,
            config=req.config, params_schema=req.params_schema,
            owner_id=user["username"], is_published=req.is_published,
        )
        db.add(t)
        db.commit()
        db.refresh(t)
        return t.to_dict()
    finally:
        db.close()


@router.put("/{tool_id}")
async def update_tool(tool_id: str, req: ToolRequest, user: dict = Depends(require_role("builder", "admin"))):
    db = SessionLocal()
    try:
        t = db.get(Tool, tool_id)
        if not t:
            raise HTTPException(404, "工具不存在")
        if t.owner_id != user["username"] and user["role"] != "admin":
            raise HTTPException(403, "只能编辑自己的工具")
        t.name = req.name
        t.description = req.description
        t.type = req.type
        t.config = req.config
        t.params_schema = req.params_schema
        t.is_published = req.is_published
        db.commit()
        return t.to_dict()
    finally:
        db.close()


@router.delete("/{tool_id}")
async def delete_tool(tool_id: str, user: dict = Depends(require_role("builder", "admin"))):
    if tool_id in ("run_aero_tool", "run_sweep_in_sandbox"):
        raise HTTPException(400, "内置工具不可删")
    db = SessionLocal()
    try:
        t = db.get(Tool, tool_id)
        if not t:
            raise HTTPException(404, "工具不存在")
        if t.owner_id != user["username"] and user["role"] != "admin":
            raise HTTPException(403, "只能删除自己的工具")
        db.delete(t)
        db.commit()
        return {"deleted": tool_id}
    finally:
        db.close()
