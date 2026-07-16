"""知识库文档 ORM(V2 §3 向量 RAG)。

两张表(主从):
  - knowledge_docs:文档主表(上传记录 + 状态 + 复核标记)
  - knowledge_chunks:文档切块 + embedding 向量(pgvector Vector(1024))

embedding 维度锁 1024(bge-m3 类,见 knowledge/embedding.py EMBED_DIM)。
建表后维度不可改,换 embedding 模型需重建 chunks 表 + 重新索引全部文档。
"""
from __future__ import annotations

import uuid
from sqlalchemy import Column, String, Text, Integer, DateTime, ForeignKey
from sqlalchemy.sql import func
from pgvector.sqlalchemy import Vector

from app.db import Base

EMBED_DIM = 1024  # bge-m3 类维度,与 knowledge/embedding.py 一致


def _new_id(prefix: str) -> str:
    return prefix + uuid.uuid4().hex[:16]


class KnowledgeDoc(Base):
    """上传的文档主记录。"""
    __tablename__ = "knowledge_docs"

    id = Column(String(64), primary_key=True, default=lambda: _new_id("kdoc_"))
    filename = Column(String(256), nullable=False)
    # sha256 内容指纹(幂等:同内容重复上传不重复入库)
    sha256 = Column(String(64), nullable=False, unique=True, index=True)
    # processing(摄入中)/ ready(可检索)/ failed(摄入失败,看 error)
    status = Column(String(24), nullable=False, default="processing")
    error = Column(Text, nullable=False, default="")  # failed 时的错误说明
    # 复核标记(V1 §5.3 知识入库人工复核)
    review_status = Column(String(24), nullable=False, default="unreviewed")  # unreviewed/reviewed/flagged
    owner_id = Column(String(64), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "filename": self.filename, "sha256": self.sha256,
            "status": self.status, "error": self.error, "review_status": self.review_status,
            "owner_id": self.owner_id, "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class KnowledgeChunk(Base):
    """文档切块 + 向量。一个 doc → 多个 chunk。"""
    __tablename__ = "knowledge_chunks"

    id = Column(String(64), primary_key=True, default=lambda: _new_id("kchk_"))
    doc_id = Column(String(64), ForeignKey("knowledge_docs.id", ondelete="CASCADE"), nullable=False, index=True)
    chunk_index = Column(Integer, nullable=False)  # 文档内顺序
    text = Column(Text, nullable=False)
    embedding = Column(Vector(EMBED_DIM), nullable=True)  # channel 未配时为 NULL(占位摄入失败)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    def to_dict(self) -> dict:
        # 不含 embedding(向量太大,不对外暴露)
        return {
            "id": self.id, "doc_id": self.doc_id, "chunk_index": self.chunk_index,
            "text": self.text,
        }
