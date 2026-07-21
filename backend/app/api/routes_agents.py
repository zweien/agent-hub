"""Agent 配置路由(§8 配置面)。

- GET /agents:所有已发布配置(user 可读)
- GET /agents/{id}:单个详情
- POST /agents:创建(仅 builder/admin)
- PUT /agents/{id}:编辑(仅 owner 且 builder/admin)
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user, require_role
from app.db import SessionLocal
from app.models.agent_config import AgentConfig

router = APIRouter(prefix="/agents", tags=["agents"])


class AgentConfigRequest(BaseModel):
    name: str
    system_prompt: str
    tools: list[str] = []
    skill_ids: list[str] = []   # 引用的能力包(§4.6),会话启动时同步进容器
    sandbox_template_id: str | None = None  # 引用的沙箱模板;空=全局默认
    model: str = "deepseek-v4-flash"
    mode: str = "standard"
    type: str = "flat"  # flat(默认)| canvas(V2 §5 画布编排)
    # 子代理类型(V2 §4):[{name, description, prompt, tools[], model}]
    subagent_types: list[dict] = []
    # 画布图定义(V2 §5,仅 type=canvas):{nodes, edges, entry_node_id}
    canvas_def: dict = {}
    is_published: bool = False


class GenerateCanvasRequest(BaseModel):
    description: str  # 自然语言流程描述


@router.get("")
async def list_agents(user: dict = Depends(get_current_user)):
    """列表:user 看所有已发布;builder/admin 看全部(含自己的草稿)。"""
    db = SessionLocal()
    try:
        q = db.query(AgentConfig)
        if user["role"] == "user":
            q = q.filter(AgentConfig.is_published == True)
        rows = q.order_by(AgentConfig.created_at.desc()).all()
        return [r.to_dict() for r in rows]
    finally:
        db.close()


@router.get("/{agent_id}")
async def get_agent(agent_id: str, user: dict = Depends(get_current_user)):
    db = SessionLocal()
    try:
        cfg = db.get(AgentConfig, agent_id)
        if not cfg:
            raise HTTPException(404, "配置不存在")
        if user["role"] == "user" and not cfg.is_published:
            raise HTTPException(403, "无权查看未发布配置")
        return cfg.to_dict()
    finally:
        db.close()


@router.post("")
async def create_agent(req: AgentConfigRequest, user: dict = Depends(require_role("builder", "admin"))):
    db = SessionLocal()
    try:
        cfg = AgentConfig(
            name=req.name, system_prompt=req.system_prompt, tools=req.tools,
            skill_ids=req.skill_ids, sandbox_template_id=req.sandbox_template_id,
            model=req.model, mode=req.mode,
            type=req.type, subagent_types=req.subagent_types, canvas_def=req.canvas_def,
            owner_id=user["username"], is_published=req.is_published,
        )
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
        return cfg.to_dict()
    finally:
        db.close()


@router.put("/{agent_id}")
async def update_agent(agent_id: str, req: AgentConfigRequest, user: dict = Depends(require_role("builder", "admin"))):
    db = SessionLocal()
    try:
        cfg = db.get(AgentConfig, agent_id)
        if not cfg:
            raise HTTPException(404, "配置不存在")
        if cfg.owner_id != user["username"] and user["role"] != "admin":
            raise HTTPException(403, "只能编辑自己的配置")
        cfg.name = req.name
        cfg.system_prompt = req.system_prompt
        cfg.tools = req.tools
        cfg.skill_ids = req.skill_ids
        cfg.sandbox_template_id = req.sandbox_template_id
        cfg.model = req.model
        cfg.mode = req.mode
        cfg.type = req.type
        cfg.subagent_types = req.subagent_types
        cfg.canvas_def = req.canvas_def
        cfg.is_published = req.is_published
        db.commit()
        return cfg.to_dict()
    finally:
        db.close()


@router.post("/{agent_id}/generate-canvas")
async def generate_canvas_route(agent_id: str, req: GenerateCanvasRequest, user: dict = Depends(require_role("builder", "admin"))):
    """自然语言生成画布图定义(NL→canvas_def)。

    用该 agent 的 tools + subagent_types 作上下文,LLM 一次调用生成 canvas_def,
    经 compile_canvas 校验后返回(失败返回 422 + 错误定位)。
    """
    from app.agent_runtime.canvas_generator import generate_canvas
    from app.agent_runtime.canvas_compiler import compile_canvas, CanvasCompileError
    from langgraph.checkpoint.memory import MemorySaver

    db = SessionLocal()
    try:
        cfg = db.get(AgentConfig, agent_id)
        if not cfg:
            raise HTTPException(404, "配置不存在")
        if cfg.owner_id != user["username"] and user["role"] != "admin":
            raise HTTPException(403, "只能编辑自己的配置")
        tools = set(cfg.tools or [])
        subagents = cfg.subagent_types or []
        model = cfg.model
    finally:
        db.close()

    # 1. LLM 生成 canvas_def
    try:
        canvas_def = await generate_canvas(req.description, model=model, enabled_tools=tools, subagent_types=subagents)
    except ValueError as e:
        raise HTTPException(422, f"生成失败: {e}")

    # 2. 编译校验(确保生成的是可执行图;不校验则前端保存后运行才暴露错误)
    try:
        compile_canvas(canvas_def, model, tools, subagents, MemorySaver())
    except CanvasCompileError as e:
        # 返回 canvas_def + 错误,前端可展示定位(用户改描述重试)
        return {"ok": False, "error": f"生成的图编译失败: {e}", "canvas_def": canvas_def}

    return {"ok": True, "canvas_def": canvas_def}
