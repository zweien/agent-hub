"""Skill 管理路由(§4.6 能力包,A 类配置/B 类只读)。

镜像 routes_agents.py 的 CRUD + 角色/owner 控制。
额外:脚本文件上传/删除(multipart,存 backend/skills/<id>/scripts/)。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel

from app.auth import get_current_user, require_role
from app.db import SessionLocal
from app.models.skill import Skill
from app.sandbox_mgr import skill_store

router = APIRouter(prefix="/skills", tags=["skills"])


class SkillRequest(BaseModel):
    name: str
    description: str = ""
    content: str = ""          # SKILL.md 正文(不含 frontmatter)
    scripts: list[str] = []    # 脚本文件名列表(实际内容由上传接口管)
    is_published: bool = False


@router.get("")
async def list_skills(user: dict = Depends(get_current_user)):
    """列表:user 看已发布;builder/admin 看全部。"""
    db = SessionLocal()
    try:
        q = db.query(Skill)
        if user["role"] == "user":
            q = q.filter(Skill.is_published == True)
        rows = q.order_by(Skill.created_at.desc()).all()
        return [r.to_dict() for r in rows]
    finally:
        db.close()


@router.get("/{skill_id}")
async def get_skill(skill_id: str, user: dict = Depends(get_current_user)):
    db = SessionLocal()
    try:
        s = db.get(Skill, skill_id)
        if not s:
            raise HTTPException(404, "技能不存在")
        if user["role"] == "user" and not s.is_published:
            raise HTTPException(403, "无权查看未发布技能")
        return s.to_dict()
    finally:
        db.close()


@router.post("")
async def create_skill(req: SkillRequest, user: dict = Depends(require_role("builder", "admin"))):
    db = SessionLocal()
    try:
        s = Skill(
            name=req.name, description=req.description, content=req.content,
            scripts=req.scripts, owner_id=user["username"], is_published=req.is_published,
        )
        db.add(s)
        db.commit()
        db.refresh(s)
        # 同步写文件系统(供会话容器同步)
        skill_store.save_skill_files(s.id, s.content, {}, name=s.name, description=s.description)
        return s.to_dict()
    finally:
        db.close()


@router.put("/{skill_id}")
async def update_skill(skill_id: str, req: SkillRequest, user: dict = Depends(require_role("builder", "admin"))):
    db = SessionLocal()
    try:
        s = db.get(Skill, skill_id)
        if not s:
            raise HTTPException(404, "技能不存在")
        if s.owner_id != user["username"] and user["role"] != "admin":
            raise HTTPException(403, "只能编辑自己的技能")
        s.name = req.name
        s.description = req.description
        s.content = req.content
        s.is_published = req.is_published
        db.commit()
        # 同步文件系统
        skill_store.save_skill_files(s.id, s.content, {}, name=s.name, description=s.description)
        return s.to_dict()
    finally:
        db.close()


@router.delete("/{skill_id}")
async def delete_skill(skill_id: str, user: dict = Depends(require_role("builder", "admin"))):
    db = SessionLocal()
    try:
        s = db.get(Skill, skill_id)
        if not s:
            raise HTTPException(404, "技能不存在")
        if s.owner_id != user["username"] and user["role"] != "admin":
            raise HTTPException(403, "只能删除自己的技能")
        db.delete(s)
        db.commit()
        skill_store.delete_skill_files(skill_id)
        return {"deleted": skill_id}
    finally:
        db.close()


@router.post("/{skill_id}/scripts")
async def upload_script(skill_id: str, file: UploadFile = File(...),
                        user: dict = Depends(require_role("builder", "admin"))):
    """上传一个脚本文件到 skill 的 scripts/ 目录。"""
    db = SessionLocal()
    try:
        s = db.get(Skill, skill_id)
        if not s:
            raise HTTPException(404, "技能不存在")
        if s.owner_id != user["username"] and user["role"] != "admin":
            raise HTTPException(403, "只能管理自己的技能")
        data = await file.read()
        filename = file.filename or "script.py"
        skill_store.save_script(skill_id, filename, data)
        # 更新 PG 的 scripts 列表
        scripts = list(s.scripts or [])
        if filename not in scripts:
            scripts.append(filename)
            s.scripts = scripts
            db.commit()
        return {"uploaded": filename, "scripts": scripts}
    finally:
        db.close()


@router.delete("/{skill_id}/scripts/{filename}")
async def delete_script_route(skill_id: str, filename: str,
                              user: dict = Depends(require_role("builder", "admin"))):
    db = SessionLocal()
    try:
        s = db.get(Skill, skill_id)
        if not s:
            raise HTTPException(404, "技能不存在")
        if s.owner_id != user["username"] and user["role"] != "admin":
            raise HTTPException(403, "只能管理自己的技能")
        skill_store.delete_script(skill_id, filename)
        scripts = [x for x in (s.scripts or []) if x != filename]
        s.scripts = scripts
        db.commit()
        return {"deleted": filename, "scripts": scripts}
    finally:
        db.close()
