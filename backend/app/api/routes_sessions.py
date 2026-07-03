"""会话列表路由(§7,按 owner 过滤)。"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.db import SessionLocal
from app.models.session import Session

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.get("")
async def list_sessions(user: dict = Depends(get_current_user)):
    """列出当前用户的会话(admin 看全部)。"""
    db = SessionLocal()
    try:
        q = db.query(Session)
        if user["role"] != "admin":
            q = q.filter(Session.owner_id == user["username"])
        rows = q.order_by(Session.created_at.desc()).limit(50).all()
        return [{"id": r.id, "status": r.status, "title": r.title,
                 "agent_config_id": r.agent_config_id, "created_at": r.created_at.isoformat() if r.created_at else None}
                for r in rows]
    finally:
        db.close()
