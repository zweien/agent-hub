"""会话列表路由(§7,按 owner 过滤)+ 事件流回放(§5.1)。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.db import SessionLocal
from app.models.session import Session
from app.models.event import Event

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


@router.get("/{session_id}/events")
async def get_session_events(session_id: str, user: dict = Depends(get_current_user)):
    """读取某会话的完整事件流(§5.1 可回放),按 seq 升序。

    鉴权(§7):仅 owner 或 admin 可看自己的会话产出。
    """
    db = SessionLocal()
    try:
        sess = db.get(Session, session_id)
        if not sess:
            raise HTTPException(404, "会话不存在")
        if sess.owner_id != user["username"] and user["role"] != "admin":
            raise HTTPException(403, "无权查看该会话")
        rows = (
            db.query(Event)
            .filter(Event.session_id == session_id)
            .order_by(Event.seq.asc())
            .all()
        )
        return {
            "session_id": session_id,
            "title": sess.title,
            "status": sess.status,
            "events": [r.to_dict() for r in rows],
        }
    finally:
        db.close()
