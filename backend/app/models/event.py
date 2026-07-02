"""事件流 ORM(§2.5,唯一事实来源,append-only)。

每条事件 = 会话中发生的一件事(token/工具调用/状态转换/接管...)。
按 (session_id, seq) 排序重放可重建任意时刻状态。
"""
from __future__ import annotations

from sqlalchemy import Column, Integer, String, BigInteger, Text, DateTime, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from app.db import Base


class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(64), nullable=False, index=True)
    seq = Column(BigInteger, nullable=False)  # 会话内单调递增序号
    type = Column(String(32), nullable=False)  # token/tool_start/tool_end/state_change/done/error/...
    payload = Column(JSONB, nullable=True)     # 事件内容(结构化)
    actor = Column(String(16), nullable=True)   # user/agent/system
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_events_session_seq", "session_id", "seq"),
    )

    def to_dict(self) -> dict:
        return {
            "seq": self.seq,
            "type": self.type,
            "payload": self.payload,
            "actor": self.actor,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
