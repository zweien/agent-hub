"""SandboxTemplate 管理路由(沙箱配置模板,A 类配置/B 类只读)。

镜像 routes_skills.py 的 CRUD + 角色/owner 控制。
模板 = 沙箱环境配置(base 镜像 + pip 包 + 环境变量 + 硬件限制),挂 agent 配置。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user, require_role
from app.db import SessionLocal
from app.models.sandbox_template import SandboxTemplate

router = APIRouter(prefix="/sandbox-templates", tags=["sandbox-templates"])


class SandboxTemplateRequest(BaseModel):
    name: str
    base_image: str = "agent-hub-sandbox:latest"
    pip_packages: list[str] = []
    env_vars: dict = {}
    cpu_limit: float | None = None
    mem_limit: str | None = None
    gpu_count: int = 0
    shm_size: str | None = None
    is_published: bool = False


@router.get("")
async def list_templates(user: dict = Depends(get_current_user)):
    """列表:user 看已发布;builder/admin 看全部。"""
    db = SessionLocal()
    try:
        q = db.query(SandboxTemplate)
        if user["role"] == "user":
            q = q.filter(SandboxTemplate.is_published == True)
        rows = q.order_by(SandboxTemplate.created_at.desc()).all()
        return [r.to_dict() for r in rows]
    finally:
        db.close()


@router.get("/{template_id}")
async def get_template(template_id: str, user: dict = Depends(get_current_user)):
    db = SessionLocal()
    try:
        t = db.get(SandboxTemplate, template_id)
        if not t:
            raise HTTPException(404, "模板不存在")
        if user["role"] == "user" and not t.is_published:
            raise HTTPException(403, "无权查看未发布模板")
        return t.to_dict()
    finally:
        db.close()


@router.post("")
async def create_template(req: SandboxTemplateRequest, user: dict = Depends(require_role("builder", "admin"))):
    db = SessionLocal()
    try:
        t = SandboxTemplate(
            name=req.name, base_image=req.base_image, pip_packages=req.pip_packages,
            env_vars=req.env_vars, cpu_limit=req.cpu_limit, mem_limit=req.mem_limit,
            gpu_count=req.gpu_count, shm_size=req.shm_size,
            owner_id=user["username"], is_published=req.is_published,
        )
        db.add(t)
        db.commit()
        db.refresh(t)
        return t.to_dict()
    finally:
        db.close()


@router.put("/{template_id}")
async def update_template(template_id: str, req: SandboxTemplateRequest, user: dict = Depends(require_role("builder", "admin"))):
    db = SessionLocal()
    try:
        t = db.get(SandboxTemplate, template_id)
        if not t:
            raise HTTPException(404, "模板不存在")
        if t.owner_id != user["username"] and user["role"] != "admin":
            raise HTTPException(403, "只能编辑自己的模板")
        t.name = req.name; t.base_image = req.base_image
        t.pip_packages = req.pip_packages; t.env_vars = req.env_vars
        t.cpu_limit = req.cpu_limit; t.mem_limit = req.mem_limit
        t.gpu_count = req.gpu_count; t.shm_size = req.shm_size
        t.is_published = req.is_published
        db.commit()
        return t.to_dict()
    finally:
        db.close()


@router.delete("/{template_id}")
async def delete_template(template_id: str, user: dict = Depends(require_role("builder", "admin"))):
    db = SessionLocal()
    try:
        t = db.get(SandboxTemplate, template_id)
        if not t:
            raise HTTPException(404, "模板不存在")
        if t.owner_id != user["username"] and user["role"] != "admin":
            raise HTTPException(403, "只能删除自己的模板")
        db.delete(t)
        db.commit()
        return {"deleted": template_id}
    finally:
        db.close()
