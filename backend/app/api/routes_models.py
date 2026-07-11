"""模型目录路由(§8 模型选择)—— DB 唯一源的全 CRUD。

镜像 routes_tools.py 的 CRUD + 角色/owner 控制。
GET /models 只读本表(不再拉网关 /v1/models);user 角色只见 is_published。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user, require_role
from app.db import SessionLocal
from app.models.model import Model

router = APIRouter(prefix="/models", tags=["models"])


class ModelRequest(BaseModel):
    model_id: str            # 真实模型 id(deepseek-v4-flash)
    label: str               # 下拉框显示名
    max_tokens: int = 16000
    context_window: int = 65536
    supports_reasoning: bool = False
    is_published: bool = True


@router.get("")
async def list_models(user: dict = Depends(get_current_user)):
    """列表:user 看已发布;builder/admin 看全部。DB 唯一源(不拉网关)。"""
    db = SessionLocal()
    try:
        q = db.query(Model)
        if user["role"] == "user":
            q = q.filter(Model.is_published == True)
        rows = q.order_by(Model.created_at.desc()).all()
        return [r.to_dict() for r in rows]
    finally:
        db.close()


@router.get("/{model_pk}")
async def get_model(model_pk: str, user: dict = Depends(get_current_user)):
    db = SessionLocal()
    try:
        m = db.get(Model, model_pk)
        if not m:
            raise HTTPException(404, "模型不存在")
        if user["role"] == "user" and not m.is_published:
            raise HTTPException(403, "无权查看未发布模型")
        return m.to_dict()
    finally:
        db.close()


@router.post("")
async def create_model(req: ModelRequest, user: dict = Depends(require_role("builder", "admin"))):
    db = SessionLocal()
    try:
        # model_id 唯一(同一网关模型只能配一条)
        if db.query(Model).filter(Model.model_id == req.model_id).first():
            raise HTTPException(400, "模型 id 已存在")
        m = Model(
            model_id=req.model_id, label=req.label,
            max_tokens=req.max_tokens, context_window=req.context_window,
            supports_reasoning=req.supports_reasoning,
            owner_id=user["username"], is_published=req.is_published,
        )
        db.add(m)
        db.commit()
        db.refresh(m)
        return m.to_dict()
    finally:
        db.close()


@router.put("/{model_pk}")
async def update_model(model_pk: str, req: ModelRequest, user: dict = Depends(require_role("builder", "admin"))):
    db = SessionLocal()
    try:
        m = db.get(Model, model_pk)
        if not m:
            raise HTTPException(404, "模型不存在")
        if m.owner_id != user["username"] and user["role"] != "admin":
            raise HTTPException(403, "只能编辑自己的模型")
        # model_id 改了要查重(排除自身)
        if req.model_id != m.model_id:
            if db.query(Model).filter(Model.model_id == req.model_id).first():
                raise HTTPException(400, "模型 id 已存在")
        m.model_id = req.model_id
        m.label = req.label
        m.max_tokens = req.max_tokens
        m.context_window = req.context_window
        m.supports_reasoning = req.supports_reasoning
        m.is_published = req.is_published
        db.commit()
        return m.to_dict()
    finally:
        db.close()


@router.delete("/{model_pk}")
async def delete_model(model_pk: str, user: dict = Depends(require_role("builder", "admin"))):
    db = SessionLocal()
    try:
        m = db.get(Model, model_pk)
        if not m:
            raise HTTPException(404, "模型不存在")
        if m.owner_id != user["username"] and user["role"] != "admin":
            raise HTTPException(403, "只能删除自己的模型")
        db.delete(m)
        db.commit()
        return {"deleted": model_pk}
    finally:
        db.close()
