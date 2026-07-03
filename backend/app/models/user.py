"""用户(V1 最简:硬编码账号,此表仅用于未来扩展/admin 列表展示)。

V1 不存密码(硬编码在 config),此表作为占位 + admin 用户列表用。
"""
from __future__ import annotations

from sqlalchemy import Column, String, DateTime
from sqlalchemy.sql import func

from app.db import Base


class User(Base):
    __tablename__ = "users"

    username = Column(String(64), primary_key=True)
    role = Column(String(24), nullable=False)  # admin / builder / user
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
