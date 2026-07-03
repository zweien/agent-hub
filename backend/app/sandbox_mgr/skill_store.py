"""Skill 文件系统存储(§4.6)。

PG 存元数据+正文(便于查询),文件系统存原始文件(便于同步进会话容器)。
布局:
  backend/skills/<skill_id>/SKILL.md         # 正文(含 frontmatter,供 Deep Agents 读取)
  backend/skills/<skill_id>/scripts/<file>   # 附带脚本

会话启动时,SessionRegistry 读这里的文件,put_file 推进容器的 /workspace/skills/<name>/。
"""
from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger("skill_store")

# skills 根目录:优先环境变量,否则相对 app 包的上两级(app/../skills)。
# 容器内挂载在 /app/skills;本地开发在 backend/skills。
import os
_ROOT = Path(os.environ.get("SKILLS_DIR") or (Path(__file__).resolve().parent.parent.parent / "skills"))


def _skill_dir(skill_id: str) -> Path:
    return _ROOT / skill_id


def _build_skill_md(name: str, description: str, content: str) -> str:
    """拼装完整 SKILL.md(frontmatter + 正文)。Deep Agents 读 frontmatter 做 progressive disclosure。"""
    return f"""---
name: {name}
description: {description}
---

{content}
"""


def save_skill_files(skill_id: str, content: str, scripts: dict[str, bytes],
                     name: str = "", description: str = "") -> None:
    """写 SKILL.md + scripts/ 目录。

    content: SKILL.md 正文(不含 frontmatter)。
    scripts: {文件名: 内容} 字典。
    name/description: 用于拼 frontmatter(Deep Agents 读);为空时 SKILL.md 仅含正文。
    """
    d = _skill_dir(skill_id)
    (d / "scripts").mkdir(parents=True, exist_ok=True)
    md = _build_skill_md(name, description, content) if name else content
    (d / "SKILL.md").write_text(md, encoding="utf-8")
    for fname, data in scripts.items():
        (d / "scripts" / fname).write_bytes(data)
    logger.info("保存 skill 文件 %s(SKILL.md + %d 脚本)", skill_id, len(scripts))


def read_skill_files(skill_id: str) -> tuple[str, dict[str, bytes]]:
    """读回 (SKILL.md 全文含 frontmatter, {脚本名: 内容})。供同步进容器用。"""
    d = _skill_dir(skill_id)
    md_path = d / "SKILL.md"
    md = md_path.read_text(encoding="utf-8") if md_path.exists() else ""
    scripts: dict[str, bytes] = {}
    sdir = d / "scripts"
    if sdir.is_dir():
        for p in sorted(sdir.iterdir()):
            if p.is_file():
                scripts[p.name] = p.read_bytes()
    return md, scripts


def delete_skill_files(skill_id: str) -> None:
    """删整个 skill 目录。"""
    d = _skill_dir(skill_id)
    if d.exists():
        import shutil
        shutil.rmtree(d, ignore_errors=True)
        logger.info("删除 skill 文件 %s", skill_id)


def save_script(skill_id: str, filename: str, data: bytes) -> None:
    """存单个脚本(上传用)。"""
    sdir = _skill_dir(skill_id) / "scripts"
    sdir.mkdir(parents=True, exist_ok=True)
    # 防路径穿越:只取文件名
    safe = Path(filename).name
    (sdir / safe).write_bytes(data)


def delete_script(skill_id: str, filename: str) -> None:
    """删单个脚本。"""
    safe = Path(filename).name
    p = _skill_dir(skill_id) / "scripts" / safe
    if p.exists():
        p.unlink()
