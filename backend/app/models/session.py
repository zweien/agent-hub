"""会话 ORM(状态机:§2.3/§2.4)。

status: idle / running / awaiting_user / interrupted / done
会话状态独立于 WS 连接(§2.4):agent task 在后台跑,WS 只是观察者。
"""
from __future__ import annotations

import uuid
from sqlalchemy import Column, String, DateTime, Text
from sqlalchemy.sql import func

from app.db import Base


def _new_sid() -> str:
    return "sess_" + uuid.uuid4().hex[:16]


class Session(Base):
    __tablename__ = "sessions"

    id = Column(String(64), primary_key=True, default=_new_sid)
    status = Column(String(24), nullable=False, default="idle")  # state 机
    title = Column(Text, nullable=True)  # 首条用户消息摘要(便于列表)
    owner_id = Column(String(64), nullable=True)  # 所属用户(§7)
    agent_config_id = Column(String(64), nullable=True)  # 用的哪个 agent 配置(§8)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
