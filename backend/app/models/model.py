"""Model ORM(模型目录,§8 模型选择)。

一个 Model = LLM 网关里可调用的模型 + 平台侧元数据(max_tokens/context_window/
supports_reasoning)。DB 是唯一源(GET /models 只读本表,不再拉网关 /v1/models)。

加新模型:在「模型管理」页面新增(填 model_id/label/max_tokens 等)。
resolve_model 读本表,命中用其值,未命中回落全局 LLM_MAX_TOKENS/LLM_CONTEXT_WINDOW。
"""
from __future__ import annotations

import uuid
from sqlalchemy import Column, String, Integer, Boolean, DateTime
from sqlalchemy.sql import func

from app.db import Base


def _new_id() -> str:
    return "model_" + uuid.uuid4().hex[:16]


class Model(Base):
    __tablename__ = "models"

    id = Column(String(64), primary_key=True, default=_new_id)
    # 真实模型 id(与网关 model 字段对齐,如 deepseek-v4-flash);build_agent 用它构造 ChatOpenAI
    model_id = Column(String(128), nullable=False, unique=True)
    label = Column(String(128), nullable=False)  # 下拉框显示名
    max_tokens = Column(Integer, nullable=False, default=16000)  # reasoning 计入,留足空间
    context_window = Column(Integer, nullable=False, default=65536)  # SummarizationMiddleware 用
    supports_reasoning = Column(Boolean, nullable=False, default=False)  # 是否推理模型
    owner_id = Column(String(64), nullable=False)
    is_published = Column(Boolean, nullable=False, default=True)  # user 角色只见 published
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "model_id": self.model_id, "label": self.label,
            "max_tokens": self.max_tokens, "context_window": self.context_window,
            "supports_reasoning": self.supports_reasoning,
            "owner_id": self.owner_id, "is_published": self.is_published,
        }
