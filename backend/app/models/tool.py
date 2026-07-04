"""Tool ORM(统一工具管理,§2.1 分层 + grilling 工具管理决策)。

一个 Tool = agent 可 function-call 的能力单元。异构类型统一存:
  - python/bash:config.code 在会话 sandbox 容器内 exec(安全隔离)
  - web:config 声明 URL/方法/鉴权,后端发 HTTP 转发
  - mcp:config 声明 MCP server,后端起 client 转发
  - builtin:平台内置工具(run_aero_tool 等),不存于表(工厂直接给)

params_schema:JSON Schema,描述入参(给 LLM 生成 function-call 参数)。
config:type-specific 配置(JSONB)。
"""
from __future__ import annotations

import uuid
from sqlalchemy import Column, String, Text, Boolean, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from app.db import Base

# 工具类型枚举值
TOOL_TYPES = ("python", "bash", "web", "mcp", "builtin")


def _new_id() -> str:
    return "tool_" + uuid.uuid4().hex[:16]


class Tool(Base):
    __tablename__ = "tools"

    id = Column(String(64), primary_key=True, default=_new_id)
    name = Column(String(128), nullable=False, unique=True)  # 对外名,LLM function-call 用
    description = Column(Text, nullable=False, default="")   # 给 LLM 看的工具说明
    type = Column(String(24), nullable=False)                # python/bash/web/mcp
    # type-specific 配置:
    #   python/bash: {"code": "...", "workdir": "/tmp"}
    #   web: {"url", "method", "headers", "param_mapping", "auth_header"}
    #   mcp: {"server_command": ["..."], "server_url": "...", "tool_filter": [...]}
    config = Column(JSONB, nullable=False, default=dict)
    # 入参 JSON Schema(给 LLM): {"type":"object","properties":{"a":{"type":"number"}},...}
    params_schema = Column(JSONB, nullable=False, default=dict)
    owner_id = Column(String(64), nullable=False)
    is_published = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "description": self.description,
            "type": self.type, "config": self.config, "params_schema": self.params_schema,
            "owner_id": self.owner_id, "is_published": self.is_published,
        }
