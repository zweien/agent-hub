"""知识库 embedding(V2 §3,ADR-0001)。

embedding 源 = Gateway /embeddings(运维在网关配 channel)。本模块是唯一的
embedding 调用点:channel 未配/报错时抛 EmbeddingNotConfigured,上层(ingest)
捕获 → 文档 status=failed,不崩溃。channel 配好后此函数无需改(已写好 OpenAI
兼容调用),只需运维在网关配上 kb_embedding_model(默认 bge-m3)对应的 channel。

向量维度 EMBED_DIM=1024(bge-m3 类),与 knowledge_doc.EMBED_DIM / chunks.embedding
列定义一致。换不同维度的模型需重建 chunks 表 + 重新索引全部文档。
"""
from __future__ import annotations

import logging

import httpx

from app.config import get_settings

logger = logging.getLogger("knowledge.embedding")

EMBED_DIM = 1024  # 与 models/knowledge_doc.EMBED_DIM 一致(bge-m3 类)


class EmbeddingNotConfigured(RuntimeError):
    """Gateway 未配 embedding channel(ADR-0001)。上层应捕获并降级。"""


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """批量 embedding。返回与 texts 等长的向量列表(每个 1024 维)。

    走 Gateway OpenAI 兼容 /embeddings。channel 未配(model_not_found)/ 网关不可达
    / 返回异常 → 抛 EmbeddingNotConfigured。
    """
    if not texts:
        return []
    s = get_settings()
    url = s.llm_base_url.rstrip("/") + "/embeddings"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                url,
                headers={"Authorization": f"Bearer {s.llm_api_key}", "Content-Type": "application/json"},
                json={"model": s.kb_embedding_model, "input": texts},
            )
    except httpx.HTTPError as e:
        # 网关不可达/超时
        raise EmbeddingNotConfigured(f"embedding 网关不可达: {e}") from e
    if resp.status_code != 200:
        # 典型:channel 未配 → 400/404 model_not_found
        body = resp.text[:200]
        raise EmbeddingNotConfigured(
            f"embedding 调用失败({resp.status_code}),可能是网关未配 embedding channel"
            f"(model={s.kb_embedding_model}): {body}"
        )
    data = resp.json().get("data", [])
    # OpenAI 兼容:按 index 排序保证顺序与输入一致
    data.sort(key=lambda d: d.get("index", 0))
    vectors = [d["embedding"] for d in data]
    if len(vectors) != len(texts):
        raise EmbeddingNotConfigured(
            f"embedding 返回数量不匹配(输入 {len(texts)}, 返回 {len(vectors)})"
        )
    # 维度校验(防止运维配了不同维度的模型)
    if vectors and len(vectors[0]) != EMBED_DIM:
        raise EmbeddingNotConfigured(
            f"embedding 维度 {len(vectors[0])} 与预期 {EMBED_DIM} 不一致"
            f"(model={s.kb_embedding_model});需重建知识库表并改 EMBED_DIM"
        )
    return vectors


async def embed_query(query: str) -> list[float]:
    """单条 query embedding(检索用)。"""
    vecs = await embed_texts([query])
    return vecs[0]
