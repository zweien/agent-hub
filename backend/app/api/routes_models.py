"""模型目录路由(§8 模型选择)。

GET /models:从网关 /v1/models 拉 id 列表,merge 本地 MODELS 覆盖层(标签/上下文窗口/
supports_reasoning),返回给前端填充下拉框。网关不可达时降级为纯本地列表。
"""
from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.config import MODELS, resolve_model, get_settings

logger = logging.getLogger("routes_models")
router = APIRouter(prefix="/models", tags=["models"])


@router.get("")
async def list_models(user: dict = Depends(get_current_user)):
    """返回可用模型列表(id/label/context_window/supports_reasoning)。

    id 列表来源:网关 /v1/models(优先,实时反映网关注册的模型)→ merge 本地覆盖层。
    网关不可达时降级为纯本地 MODELS(保证前端不空白)。
    不返回 max_tokens(那是 build_agent 构造 ChatOpenAI 时用的,前端不需要)。
    """
    s = get_settings()
    gw_ids: list[str] = []
    try:
        # 网关 /v1/models(base_url 已含 /v1,直接拼 /models)
        url = s.llm_base_url.rstrip("/") + "/models"
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(url, headers={"Authorization": f"Bearer {s.llm_api_key}"})
        resp.raise_for_status()
        data = resp.json()
        for m in data.get("data", []):
            mid = m.get("id")
            if mid:
                gw_ids.append(mid)
    except Exception as e:
        # 降级:网关不可达/超时/格式异常 → 用纯本地列表
        logger.warning("拉取网关 /v1/models 失败,降级为本地 MODELS 列表: %s", e)

    if not gw_ids:
        # 网关没拿到(失败或空),用本地 MODELS 键
        gw_ids = list(MODELS.keys())

    # merge 本地覆盖层;网关有但本地无的走 resolve_model 兜底(label=原 id)
    result = []
    for mid in gw_ids:
        mi = resolve_model(mid)
        result.append({
            "id": mid,
            "label": mi["label"],
            "context_window": mi["context_window"],
            "supports_reasoning": mi["supports_reasoning"],
        })
    return result
