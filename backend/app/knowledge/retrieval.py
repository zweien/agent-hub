"""知识库检索(V2 §3)。

search(query, top_k):embed query → pgvector 余弦相似度(<=> 算子)ORDER BY
→ 返回 top_k{text, doc_filename, chunk_index, score}。embedding 源未配时
抛 EmbeddingNotConfigured(调用方 search_knowledge 工具捕获,返回友好错误)。
"""
from __future__ import annotations

import logging

from sqlalchemy import select

from app.db import SessionLocal
from app.models.knowledge_doc import KnowledgeDoc, KnowledgeChunk
from app.knowledge.embedding import embed_query

logger = logging.getLogger("knowledge.retrieval")


async def search(query: str, top_k: int = 5) -> list[dict]:
    """向量检索 top_k 相关块。返回 [{text, doc_filename, chunk_index, score}]。"""
    qvec = await embed_query(query)  # 未配时抛 EmbeddingNotConfigured
    db = SessionLocal()
    try:
        # 只检索已 ready 文档的 chunks(embedding 非 NULL)
        # pgvector 余弦距离:<=> ,值越小越相似;转相似度 score = 1 - distance
        stmt = (
            select(
                KnowledgeChunk.text,
                KnowledgeChunk.chunk_index,
                KnowledgeDoc.filename,
                KnowledgeChunk.embedding.cosine_distance(qvec).label("distance"),
            )
            .join(KnowledgeDoc, KnowledgeChunk.doc_id == KnowledgeDoc.id)
            .where(KnowledgeDoc.status == "ready")
            .where(KnowledgeChunk.embedding.isnot(None))
            .order_by("distance")
            .limit(top_k)
        )
        rows = db.execute(stmt).all()
        return [
            {
                "text": r[0],
                "chunk_index": r[1],
                "doc_filename": r[2],
                "score": round(1 - r[3], 4),  # 距离 → 相似度
            }
            for r in rows
        ]
    finally:
        db.close()
