"""知识库文档摄入(V2 §3)。

ingest_document(doc_id, raw):解析 → 切块 → embedding → 写 chunks 表 → 更新
doc status。任一步失败 → status=failed + error。由 route 用 asyncio.create_task
后台调用(V1 §2.4 模式,不上 Celery)。embedding 源未配 → EmbeddingNotConfigured
被捕获 → status=failed,不崩溃。
"""
from __future__ import annotations

import logging

from app.db import SessionLocal
from app.models.knowledge_doc import KnowledgeDoc, KnowledgeChunk
from app.knowledge.parser import extract_text, chunk_text
from app.knowledge.embedding import embed_texts, EmbeddingNotConfigured

logger = logging.getLogger("knowledge.ingest")


async def ingest_document(doc_id: str, raw: bytes) -> None:
    """后台摄入一个文档。失败时把 doc 标 failed(不抛,吞掉异常只记日志 + DB)。"""
    db = SessionLocal()
    try:
        doc = db.get(KnowledgeDoc, doc_id)
        if not doc:
            logger.warning("ingest: 文档 %s 不存在", doc_id)
            return
        try:
            # 1. 解析
            text = extract_text(doc.filename, raw)
            if not text.strip():
                raise ValueError("文档内容为空(可能是扫描件 PDF 无文字层)")
            # 2. 切块
            chunks = chunk_text(text)
            if not chunks:
                raise ValueError("切块后无内容")
            logger.info("ingest %s: 解析出 %d 字符, 切 %d 块", doc.filename, len(text), len(chunks))
            # 3. embedding(channel 未配这里抛 EmbeddingNotConfigured)
            vectors = await embed_texts(chunks)
            # 4. 写 chunks 表
            for i, (chunk_text_, vec) in enumerate(zip(chunks, vectors)):
                db.add(KnowledgeChunk(
                    doc_id=doc_id, chunk_index=i, text=chunk_text_, embedding=vec,
                ))
            doc.status = "ready"
            doc.error = ""
            db.commit()
            logger.info("ingest %s 完成: %d 块入库", doc.filename, len(chunks))
        except EmbeddingNotConfigured as e:
            # embedding 源未配:最常见的预期失败,标 failed 但说明清楚
            doc.status = "failed"
            doc.error = f"embedding 源未配置: {e}"
            db.commit()
            logger.warning("ingest %s 失败(embedding 未配): %s", doc.filename, e)
        except Exception as e:
            doc.status = "failed"
            doc.error = f"{type(e).__name__}: {str(e)[:300]}"
            db.commit()
            logger.exception("ingest %s 失败", doc.filename)
    finally:
        db.close()
