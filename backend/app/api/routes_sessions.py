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

# artifacts 扫描根:整个 /workspace(agent 用 write_file 自由选路径写,
# 不强制写 /workspace/artifacts/,故扫整个工作区,排除 skills 目录)。
ARTIFACTS_ROOT = "/workspace"
# 扫描时排除的子目录(skills 是能力包,非产物)
_ARTIFACTS_EXCLUDE_DIRS = {"skills"}

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
    """列出会话沙箱 /workspace 下的所有产物文件(递归,排除 skills 目录)。

    返回 [{name, size, mtime, type}],name 为相对 /workspace 的路径
    (如 "report.md" 或 "out/wing.step")。owner 校验沿用 session 级。
    """
    db = SessionLocal()
    try:
        _check_session_owner(db, session_id, user)
    finally:
        db.close()
    container = _get_container(session_id)
    # find 递归列文件,-printf 输出 "相对路径\t大小\tmtime",排除 skills 目录。
    # 用 -mindepth 1 避免把根目录自身列出;路径用 %P(相对起点)作 name。
    excludes = " ".join(f'-path {ARTIFACTS_ROOT}/{d} -prune -o' for d in _ARTIFACTS_EXCLUDE_DIRS)
    cmd = (
        f'find "{ARTIFACTS_ROOT}" -mindepth 1 {excludes} '
        f'-type f -printf "%P\\t%s\\t%T@\\n" 2>/dev/null'
    )
    result = container.exec_run(["bash", "-lc", cmd])
    out = (result.output.decode() if isinstance(result.output, bytes) else str(result.output)).strip()
    items = []
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        name, size_s, mtime_s = parts[0], parts[1], parts[2]
        try:
            size = int(size_s)
            mtime = int(float(mtime_s))
        except ValueError:
            continue
        if not name:
            continue
        ext = os.path.splitext(name)[1].lower()
        items.append({"name": name, "size": size, "mtime": mtime, "type": ext.lstrip(".") or "file"})
    # 按修改时间降序(最新产物在前)
    items.sort(key=lambda x: x["mtime"], reverse=True)
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
    filename 为相对 /workspace 的路径(如 "report.md" 或 "out/wing.step")。
    """
    # 防路径穿越:拒绝绝对路径 / .. 段,只允许相对 /workspace 的子路径
    if not filename or filename.startswith("/") or ".." in filename.split("/"):
        raise HTTPException(400, "无效文件名")

    resolved_user = _resolve_user(user, token)
    db = SessionLocal()
    try:
        _check_session_owner(db, session_id, resolved_user)
    finally:
        db.close()

    container = _get_container(session_id)
    # base64 读出文件内容(兼容二进制,参考 docker_backend.py download_files)
    # filename 已校验无 .. / 非绝对,拼接到 ARTIFACTS_ROOT 下
    target = f"{ARTIFACTS_ROOT}/{filename}"
    result = container.exec_run(
        ["bash", "-lc", f'base64 "{target}" 2>/dev/null'],
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
    # Content-Disposition 文件名用 basename(避免路径斜杠),非 ASCII 用 RFC 5987
    # filename*=UTF-8 编码(latin-1 header 编不了中文,会 UnicodeEncodeError)。
    disp_name = os.path.basename(filename)
    try:
        disp_name.encode("latin-1")
        disp = f'filename="{disp_name}"'
    except UnicodeEncodeError:
        from urllib.parse import quote
        disp = f"filename*=UTF-8''{quote(disp_name)}"
    disposition_type = "attachment" if not inline else "inline"
    headers = {"Content-Disposition": f"{disposition_type}; {disp}"}
    return Response(content=raw, media_type=content_type, headers=headers)
