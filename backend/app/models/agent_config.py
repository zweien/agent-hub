"""Agent 配置 ORM(§8 配置面,A 类配置/B 类只读)。

一个 AgentConfig = 一个可复用的 agent 定义(prompt/工具/模型/防护模式)。
builder 创建/编辑,user 只读引用。build_agent 从此表读取代硬编码。
"""
from __future__ import annotations

import uuid
from sqlalchemy import Column, String, Text, Boolean, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from app.db import Base


def _new_id() -> str:
    return "agent_" + uuid.uuid4().hex[:16]


class AgentConfig(Base):
    __tablename__ = "agent_configs"

    id = Column(String(64), primary_key=True, default=_new_id)
    name = Column(String(128), nullable=False)
    system_prompt = Column(Text, nullable=False)
    tools = Column(JSONB, nullable=False, default=list)  # ["run_aero_tool", "run_sweep_in_sandbox"]
    # 引用的 skill id 列表(§4.6 能力包,会话启动时同步进容器 /workspace/skills/)
    skill_ids = Column(JSONB, nullable=False, default=list)
    # 引用的沙箱模板(grilling:预置包+硬件配置);空=用全局默认
    sandbox_template_id = Column(String(64), nullable=True)
    model = Column(String(64), nullable=False, default="deepseek-v4-flash")
    mode = Column(String(24), nullable=False, default="standard")  # strict/standard/yolo
    owner_id = Column(String(64), nullable=False)  # 创建者 username
    is_published = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "system_prompt": self.system_prompt,
            "tools": self.tools, "skill_ids": self.skill_ids,
            "sandbox_template_id": self.sandbox_template_id,
            "model": self.model, "mode": self.mode,
            "owner_id": self.owner_id, "is_published": self.is_published,
        }
