"""会话列表路由(§7,按 owner 过滤)+ 事件流回放(§5.1)+ artifacts 产物(§text-to-CAD)。

artifacts:会话沙箱容器内 /workspace/artifacts/ 目录的产物(STEP/STL/PNG 等),
供前端下载/预览。鉴权沿用 session 级 owner 校验。
"""
from __future__ import annotations

import base64
import logging
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.auth import get_current_user, get_optional_user, verify_token
from app.db import SessionLocal
from app.models.session import Session
from app.models.event import Event

logger = logging.getLogger("api.sessions")
router = APIRouter(prefix="/sessions", tags=["sessions"])

# artifacts 在容器内的固定目录
ARTIFACTS_DIR = "/workspace/artifacts"

# 文件扩展名 → Content-Type 映射(图片 inline 显示,3D/CAD 文件触发下载)
_CONTENT_TYPES = {
    ".png": ("image/png", True),       # (content_type, inline)
    ".jpg": ("image/jpeg", True),
    ".jpeg": ("image/jpeg", True),
    ".gif": ("image/gif", True),
    ".webp": ("image/webp", True),
    ".svg": ("image/svg+xml", True),
    ".step": ("application/step", False),
    ".stp": ("application/step", False),
    ".stl": ("model/stl", False),
    ".3mf": ("model/3mf", False),
    ".glb": ("model/gltf-binary", False),
    ".gltf": ("model/gltf+json", False),
    ".obj": ("model/obj", False),
    ".pdf": ("application/pdf", True),
    ".txt": ("text/plain", True),
    ".json": ("application/json", True),
    ".csv": ("text/csv", False),
}


def _check_session_owner(db, session_id: str, user: dict):
    """校验会话存在且调用者是 owner(或 admin)。返回 Session。"""
    sess = db.get(Session, session_id)
    if not sess:
        raise HTTPException(404, "会话不存在")
    if sess.owner_id != user["username"] and user["role"] != "admin":
        raise HTTPException(403, "无权查看该会话")
    return sess


def _resolve_user(bearer_user: Optional[dict], token: Optional[str]) -> dict:
    """双模式鉴权:Authorization header(Bearer)或 ?token=(供 <img> 标签用)。"""
    if bearer_user is not None:
        return bearer_user
    if token:
        return verify_token(token)
    raise HTTPException(401, "未提供 token(header 或 query)")


@router.get("")
async def list_sessions(user: dict = Depends(get_current_user)):
    """列出当前用户的会话(admin 看全部)。"""
    db = SessionLocal()
    try:
        q = db.query(Session)
        if user["role"] != "admin":
            q = q.filter(Session.owner_id == user["username"])
        rows = q.order_by(Session.created_at.desc()).limit(50).all()
        return [{"id": r.id, "status": r.status, "title": r.title,
                 "agent_config_id": r.agent_config_id, "created_at": r.created_at.isoformat() if r.created_at else None}
                for r in rows]
    finally:
        db.close()


@router.get("/{session_id}/events")
async def get_session_events(session_id: str, user: dict = Depends(get_current_user)):
    """读取某会话的完整事件流(§5.1 可回放),按 seq 升序。

    鉴权(§7):仅 owner 或 admin 可看自己的会话产出。
    """
    db = SessionLocal()
    try:
        sess = db.get(Session, session_id)
        if not sess:
            raise HTTPException(404, "会话不存在")
        if sess.owner_id != user["username"] and user["role"] != "admin":
            raise HTTPException(403, "无权查看该会话")
        rows = (
            db.query(Event)
            .filter(Event.session_id == session_id)
            .order_by(Event.seq.asc())
            .all()
        )
        return {
            "session_id": session_id,
            "title": sess.title,
            "status": sess.status,
            "events": [r.to_dict() for r in rows],
        }
    finally:
        db.close()


# —— Artifacts:会话沙箱容器内的产物(STEP/STL/PNG 等) ——


def _get_container(session_id: str):
    """取会话对应的 docker 容器(不依赖内存 registry,backend 重启后仍可工作)。"""
    from app.sandbox_mgr.manager import get_manager, CONTAINER_PREFIX
    mgr = get_manager()
    name = f"{CONTAINER_PREFIX}{session_id}"
    try:
        return mgr._client.containers.get(name)
    except Exception:
        raise HTTPException(404, "会话容器未运行(可能已空闲回收,发条消息重启)")


@router.get("/{session_id}/sandbox")
async def get_session_sandbox(session_id: str, user: dict = Depends(get_current_user)):
    """会话级沙箱状态:容器是否活跃 + 接管 URL。

    供对话页显示"沙箱活跃/已回收"徽章。判定以 docker 实际容器存在为准
    (不依赖内存 registry,孤儿容器也算活跃——只要容器在,用户就能接管)。
    鉴权:仅 owner 或 admin。
    """
    db = SessionLocal()
    try:
        sess = db.get(Session, session_id)
        if not sess:
            raise HTTPException(404, "会话不存在")
        if sess.owner_id != user["username"] and user["role"] != "admin":
            raise HTTPException(403, "无权查看该会话")
    finally:
        db.close()

    from app.sandbox_mgr.manager import get_manager, CONTAINER_PREFIX
    mgr = get_manager()
    name = f"{CONTAINER_PREFIX}{session_id}"
    try:
        c = mgr._client.containers.get(name)
        active = c.status == "running"
        # 取宿主端口拼 URL(与 routes_sandboxes 一致)
        url = None
        try:
            ports = c.ports.get("8080/tcp")
            if ports:
                url = f"http://localhost:{ports[0]['HostPort']}"
        except Exception:
            pass
        return {"active": active, "url": url}
    except Exception:
        # 容器不存在(已回收或从未创建)
        return {"active": False, "url": None}


@router.get("/{session_id}/artifacts")
async def list_artifacts(
    session_id: str,
    user: dict = Depends(get_current_user),
):
    """列出会话沙箱 artifacts 目录下的所有产物。

    返回 [{name, size, mtime}]。owner 校验沿用 session 级。
    """
    db = SessionLocal()
    try:
        _check_session_owner(db, session_id, user)
    finally:
        db.close()
    container = _get_container(session_id)
    # ls 取文件名+大小+时间,用 \t 分隔方便解析
    result = container.exec_run(
        ["bash", "-lc", f'ls -lt --time-style=+%s "{ARTIFACTS_DIR}" 2>/dev/null | tail -n +2'],
    )
    out = (result.output.decode() if isinstance(result.output, bytes) else str(result.output)).strip()
    items = []
    for line in out.splitlines():
        parts = line.split()
        if len(parts) < 6:
            continue
        try:
            size = int(parts[4])
            mtime = int(parts[5])
            name = " ".join(parts[6:])
        except (ValueError, IndexError):
            continue
        if not name:
            continue
        ext = os.path.splitext(name)[1].lower()
        items.append({"name": name, "size": size, "mtime": mtime, "type": ext.lstrip(".") or "file"})
    return items


@router.get("/{session_id}/artifacts/{filename:path}")
async def get_artifact(
    session_id: str,
    filename: str,
    token: Optional[str] = Query(default=None),
    user: Optional[dict] = Depends(get_optional_user),
):
    """下载/预览单个 artifact。

    鉴权双模式:Authorization header(JWT)或 ?token=(供 <img src=...> 用)。
    按 .ext 设 Content-Type:图片 inline 显示,STEP/STL 触发下载。
    """
    # 防路径穿越:只取文件名
    filename = os.path.basename(filename)
    if not filename:
        raise HTTPException(400, "无效文件名")

    resolved_user = _resolve_user(user, token)
    db = SessionLocal()
    try:
        _check_session_owner(db, session_id, resolved_user)
    finally:
        db.close()

    container = _get_container(session_id)
    # base64 读出文件内容(兼容二进制,参考 docker_backend.py download_files)
    result = container.exec_run(
        ["bash", "-lc", f'base64 "{ARTIFACTS_DIR}/{filename}" 2>/dev/null'],
    )
    b64 = (result.output.decode() if isinstance(result.output, bytes) else str(result.output))
    b64 = b64.replace("\n", "").replace("\r", "").strip()
    if not b64:
        raise HTTPException(404, f"产物 {filename} 不存在(可能 agent 尚未生成)")
    try:
        raw = base64.b64decode(b64)
    except Exception as e:
        raise HTTPException(500, f"产物解码失败: {e}")

    ext = os.path.splitext(filename)[1].lower()
    content_type, inline = _CONTENT_TYPES.get(ext, ("application/octet-stream", False))
    headers = {}
    if not inline:
        headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    else:
        headers["Content-Disposition"] = f'inline; filename="{filename}"'
    return Response(content=raw, media_type=content_type, headers=headers)
