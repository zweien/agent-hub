"""知识库路由(V2 §3 向量 RAG)。

文档上传(multipart)→ 后台异步摄入(解析+切块+embedding+入库)。embedding 源未配时
文档标 failed(不崩溃)。列表/删除/复核/检索。
"""
from __future__ import annotations

import asyncio
import hashlib
import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel

from app.auth import get_current_user, require_role
from app.db import SessionLocal
from app.models.knowledge_doc import KnowledgeDoc, KnowledgeChunk
from app.knowledge.parser import SUPPORTED_EXTS
from app.knowledge.ingest import ingest_document
from app.knowledge.retrieval import search
from app.knowledge.embedding import EmbeddingNotConfigured

logger = logging.getLogger("routes_knowledge")
router = APIRouter(prefix="/knowledge", tags=["knowledge"])


class ReviewRequest(BaseModel):
    review_status: str  # unreviewed / reviewed / flagged


@router.post("/upload")
async def upload_document(file: UploadFile = File(...), user: dict = Depends(require_role("builder", "admin"))):
    """上传文档 → 后台异步摄入。立即返回 doc(status=processing)。"""
    filename = file.filename or "untitled.txt"
    # 扩展名校验
    low = filename.lower()
    if not any(low.endswith(ext) for ext in SUPPORTED_EXTS):
        raise HTTPException(400, f"不支持的文件类型(支持 {sorted(SUPPORTED_EXTS)})")
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "文件为空")
    sha = hashlib.sha256(raw).hexdigest()
    db = SessionLocal()
    try:
        # 幂等:同 sha256 已存在 → 返回已有记录(不重复摄入)
        existing = db.query(KnowledgeDoc).filter(KnowledgeDoc.sha256 == sha).first()
        if existing:
            return {**existing.to_dict(), "deduplicated": True}
        doc = KnowledgeDoc(
            filename=filename, sha256=sha, status="processing",
            owner_id=user["username"],
        )
        db.add(doc)
        db.commit()
        db.refresh(doc)
        doc_dict = doc.to_dict()
    finally:
        db.close()
    # 后台摄入(in-memory 传 raw,避免落盘;进程重启丢任务,V1 同模式)
    asyncio.create_task(ingest_document(doc_dict["id"], raw))
    return doc_dict


@router.get("/docs")
async def list_docs(user: dict = Depends(get_current_user)):
    """文档列表(所有登录用户可见)。"""
    db = SessionLocal()
    try:
        rows = db.query(KnowledgeDoc).order_by(KnowledgeDoc.created_at.desc()).all()
        return [r.to_dict() for r in rows]
    finally:
        db.close()


@router.delete("/docs/{doc_id}")
async def delete_doc(doc_id: str, user: dict = Depends(require_role("builder", "admin"))):
    """删除文档 + 级联删 chunks(owner 或 admin)。"""
    db = SessionLocal()
    try:
        doc = db.get(KnowledgeDoc, doc_id)
        if not doc:
            raise HTTPException(404, "文档不存在")
        if doc.owner_id != user["username"] and user["role"] != "admin":
            raise HTTPException(403, "只能删除自己的文档")
        # 级联删 chunks(ON DELETE CASCADE 已设,但显式删更稳)
        db.query(KnowledgeChunk).filter(KnowledgeChunk.doc_id == doc_id).delete()
        db.delete(doc)
        db.commit()
        return {"deleted": doc_id}
    finally:
        db.close()


@router.patch("/docs/{doc_id}")
async def review_doc(doc_id: str, req: ReviewRequest, user: dict = Depends(require_role("builder", "admin"))):
    """标记复核状态(V1 §5.3:unreviewed/reviewed/flagged)。"""
    if req.review_status not in ("unreviewed", "reviewed", "flagged"):
        raise HTTPException(400, "review_status 必须是 unreviewed/reviewed/flagged")
    db = SessionLocal()
    try:
        doc = db.get(KnowledgeDoc, doc_id)
        if not doc:
            raise HTTPException(404, "文档不存在")
        if doc.owner_id != user["username"] and user["role"] != "admin":
            raise HTTPException(403, "只能复核自己的文档")
        doc.review_status = req.review_status
        db.commit()
        return doc.to_dict()
    finally:
        db.close()


@router.post("/search")
async def search_docs(req: dict, user: dict = Depends(get_current_user)):
    """检索(调试用;agent 侧走 search_knowledge 工具不经此)。

    body: {"query": "...", "top_k": 5}
    """
    query = (req.get("query") or "").strip()
    top_k = int(req.get("top_k") or 5)
    if not query:
        raise HTTPException(400, "query 必填")
    try:
        return {"results": await search(query, top_k=top_k)}
    except EmbeddingNotConfigured as e:
        raise HTTPException(503, f"embedding 源未配置,无法检索: {e}")
