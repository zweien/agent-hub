"""鉴权(§7,最简硬编码三账号 + itsdangerous 签名 token)。

token = itsdangerous 签名的 JSON {username, role, exp}
不引入 jose/jwt 重库,V1 够用。
"""
from __future__ import annotations

import time
from typing import Optional

from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.config import get_settings

security = HTTPBearer(auto_error=False)


def _serializer() -> URLSafeTimedSerializer:
    s = get_settings()
    return URLSafeTimedSerializer(s.token_secret, salt="agent-hub-auth")


def create_token(username: str, role: str) -> str:
    """签发 token(含过期时间)。"""
    s = get_settings()
    payload = {"username": username, "role": role, "exp": time.time() + s.token_expire_hours * 3600}
    return _serializer().dumps(payload)


def verify_token(token: str) -> dict:
    """校验 token,返回 {username, role}。失败抛 401。"""
    s = get_settings()
    try:
        payload = _serializer().loads(token, max_age=s.token_expire_hours * 3600)
    except (BadSignature, SignatureExpired) as e:
        raise HTTPException(status_code=401, detail=f"token 无效: {e}") from e
    return {"username": payload["username"], "role": payload["role"]}


async def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    """FastAPI 依赖:从 Bearer token 解出当前用户 {username, role}。"""
    if creds is None or not creds.credentials:
        raise HTTPException(status_code=401, detail="未提供 token")
    return verify_token(creds.credentials)


def require_role(*allowed_roles: str):
    """FastAPI 依赖工厂:要求角色在 allowed_roles 内,否则 403。"""
    async def _check(user: dict = Depends(get_current_user)) -> dict:
        if user["role"] not in allowed_roles:
            raise HTTPException(status_code=403, detail=f"需要角色 {allowed_roles},当前 {user['role']}")
        return user
    return _check


def verify_token_from_query(token: Optional[str] = Query(default=None)) -> dict:
    """WS 用:从 Query 参数校验 token(WS 无法用 Bearer header)。"""
    if not token:
        raise HTTPException(status_code=401, detail="WS 缺少 token 参数")
    return verify_token(token)
