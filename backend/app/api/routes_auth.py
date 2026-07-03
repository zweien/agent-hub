"""鉴权路由(§7,登录)。"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import get_settings
from app.auth import create_token

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    username: str
    role: str


@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest) -> LoginResponse:
    accounts = get_settings().accounts()
    acct = accounts.get(req.username)
    if not acct or acct["password"] != req.password:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    token = create_token(req.username, acct["role"])
    return LoginResponse(token=token, username=req.username, role=acct["role"])
