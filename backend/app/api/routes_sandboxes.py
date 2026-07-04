"""Sandbox 管理路由(管理员视角,§3 运维面)。

列出所有活跃会话级容器 + 手动回收。
直接查 docker 实际容器(不只依赖内存 registry,能发现重启后的孤儿容器)。
仅 admin 可访问(沙箱是基础设施,非业务资产)。
"""
from __future__ import annotations

import logging
from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_role
from app.db import SessionLocal
from app.models.session import Session
from app.agent_runtime.session_runner import registry

logger = logging.getLogger("api.sandboxes")
router = APIRouter(prefix="/sandboxes", tags=["sandboxes"])

CONTAINER_PREFIX = "agent-sandbox-"


def _list_docker_sandboxes() -> list[dict]:
    """直接查 docker 里所有 agent-sandbox-* 容器(真实状态,不依赖内存)。"""
    import time
    from app.sandbox_mgr.manager import get_manager
    mgr = get_manager()
    result = []
    db = SessionLocal()
    try:
        for c in mgr._client.containers.list(all=False, filters={"name": CONTAINER_PREFIX}):
            name = c.name
            sid = name[len(CONTAINER_PREFIX):] if name.startswith(CONTAINER_PREFIX) else name
            # 端口
            port = None
            try:
                ports = c.ports.get("8080/tcp")
                if ports:
                    port = int(ports[0]["HostPort"])
            except Exception:
                pass
            # 会话归属
            sess = db.get(Session, sid)
            # 内存里的状态(可选)
            state = registry._sessions.get(sid)
            result.append({
                "session_id": sid,
                "container_name": name,
                "container_id": c.short_id,
                "port": port,
                "sandbox_url": registry.get_container_url(sid) if state else (f"http://localhost:{port}" if port else None),
                "owner": sess.owner_id if sess else None,
                "title": sess.title if sess else None,
                "status": sess.status if sess else (c.status or "unknown"),
                "idle_seconds": int(time.time() - state.last_activity_at) if state else None,
                "task_running": bool(state and state.task and not state.task.done()),
                "in_registry": state is not None,  # 是否在后端内存里(孤儿=False)
            })
    finally:
        db.close()
    return result


@router.get("")
async def list_sandboxes(user: dict = Depends(require_role("admin"))):
    """列出所有活跃会话级容器(直接查 docker,含孤儿容器)。仅 admin。"""
    return _list_docker_sandboxes()


@router.delete("/{session_id}")
async def release_sandbox(session_id: str, user: dict = Depends(require_role("admin"))):
    """手动回收某会话的沙箱容器(docker rm -f)。仅 admin。"""
    name = f"{CONTAINER_PREFIX}{session_id}"
    from app.sandbox_mgr.manager import get_manager
    mgr = get_manager()
    try:
        c = mgr._client.containers.get(name)
        c.remove(force=True)
        logger.info("管理员回收沙箱 %s", name)
    except Exception:
        # 容器已不在,也算成功(幂等)
        raise HTTPException(404, f"沙箱 {name} 不存在")
    # 清内存 registry(若有)
    state = registry._sessions.get(session_id)
    if state:
        state.container_name = ""
    return {"released": session_id}

