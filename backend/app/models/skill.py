"""Skill ORM(§4.6 能力包,A 类配置/B 类只读)。

一个 Skill = Anthropic 式"按需加载的领域能力包":
  - name/description:progressive disclosure 的入口(agent 据描述决定是否加载)
  - content:SKILL.md 正文(领域知识 + 工作流指令)
  - scripts:附带的脚本文件名列表(进 sandbox 共享执行,决策 grilling 共识)

元数据存 PG(便于查询/列表/关联),原始文件(SKILL.md + scripts/)存文件系统
(便于同步进会话容器,见 skill_store)。
"""
from __future__ import annotations

import uuid
from sqlalchemy import Column, String, Text, Boolean, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from app.db import Base


def _new_id() -> str:
    return "skill_" + uuid.uuid4().hex[:16]


class Skill(Base):
    __tablename__ = "skills"

    id = Column(String(64), primary_key=True, default=_new_id)
    name = Column(String(128), nullable=False)
    # progressive disclosure 关键字段:agent 看到这个描述决定要不要 read SKILL.md
    description = Column(Text, nullable=False, default="")
    # SKILL.md 正文(领域知识 + 工作流指令,不含 frontmatter——frontmatter 由 name/description 承载)
    content = Column(Text, nullable=False, default="")
    # 附带脚本文件名列表(如 ["post_process.py"]);文件体存 backend/skills/<id>/scripts/
    scripts = Column(JSONB, nullable=False, default=list)
    owner_id = Column(String(64), nullable=False)
    is_published = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "description": self.description,
            "content": self.content, "scripts": self.scripts or [],
            "script_count": len(self.scripts or []),
            "owner_id": self.owner_id, "is_published": self.is_published,
        }
