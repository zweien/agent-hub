"""气动优化 Agent 内核(扁平型,§2/§3 决策)。

迁移自 poc/agent_runtime/aero_agent.py,改标准 import(去掉 sys.path hack)。
配置走 app.config(不再散落 os.getenv)。

工具:
  - run_aero_tool:后端进程内直接算(POC 验证过的快路径)
  - run_sweep_in_sandbox:经 sandbox HTTP API 跑扫描代码(决策#4)

边界(§2.2):agent_runtime 只依赖 tools/sandbox_mgr/config,不依赖 api 业务层。
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from deepagents import create_deep_agent
from langgraph.checkpoint.memory import MemorySaver

from app.config import get_settings
from app.tools.aero import run_aero
from app.sandbox_mgr.manager import get_manager

logger = logging.getLogger("aero_agent")

# 会话级上下文 checkpointer(§2.4 会话独立于连接)。
# 模块级单例:跨 build_agent 调用复用,使同一 thread_id 的 messages 自动累积。
# 进程内存储(与 SessionRegistry._sessions 同生命周期);后端重启后丢失,
# 与 V1 §2.4 边界一致("V1 不做会话数天级长期挂起")。
_checkpointer = MemorySaver()


@tool
def run_sweep_in_sandbox(area: float, ar_start: float, ar_end: float, ar_step: float) -> str:
    """在沙箱内跑展弦比参数扫描,找最大升阻比。
    会动态生成参数扫描代码并在隔离沙箱内执行(决策#4: agent写代码)。
    参数: area固定面积(平米), ar_start/ar_end/ar_step 展弦比范围与步长。
    返回扫描结果与最优展弦比。"""
    # 同步 POST /chat 路径:无会话上下文,用临时 session_id 起一次性容器
    import uuid
    ephemeral_sid = "eph_" + uuid.uuid4().hex[:12]
    try:
        return _run_sweep_raw(ephemeral_sid, area, ar_start, ar_end, ar_step)
    finally:
        try:
            get_manager().release(ephemeral_sid, destroy=True)
        except Exception:
            pass


def _standalone_llt() -> str:
    """生成可在 sandbox 内独立运行的 run_aero 脚本(不依赖 app 包,自包含 aerosandbox 调用)。"""
    return '''
import numpy as np
import aerosandbox as asb

def run_aero(*, span=10.0, area=10.0, alpha_deg=3.0, cd0=0.01, n_segs=8):
    b=span; S=area; AR=b*b/S
    ys=np.linspace(0,b/2,n_segs+1)
    chords=(4.0*S)/(np.pi*b)*np.sqrt(np.clip(1.0-(2*ys/b)**2,1e-9,None))
    af=asb.Airfoil("naca0012")
    xsecs=[asb.WingXSec(xyz_le=[0,ys[i],0],chord=chords[i],airfoil=af) for i in range(len(ys))]
    wing=asb.Wing(name="wing",xsecs=xsecs,symmetric=True)
    ac=asb.Airplane(wings=[wing])
    op=asb.OperatingPoint(velocity=1.0,alpha=alpha_deg)
    vlm=asb.VortexLatticeMethod(airplane=ac,op_point=op,spanwise_resolution=max(n_segs,10),chordwise_resolution=4)
    res=vlm.run()
    CL=float(res["CL"]); CDi=float(res["CD"])
    CD_total=cd0+CDi
    L_D=float(CL/CD_total) if CD_total>1e-12 else 0.0
    e=float(CL**2/(np.pi*AR*CDi)) if CDi>1e-12 else 1.0
    return {"CL":CL,"CDi":CDi,"CD_total":CD_total,"L_D":L_D,"Oswald_e":e,"AR":AR}
'''


# 延迟导入 run_aero_tool(避免循环/启动时算 aerosandbox)
from app.tools.aero import run_aero_tool  # noqa: E402


def build_agent(model: str = "", enabled_tools: set | None = None, system_prompt: str = ""):
    """构建 Deep Agent(路线B:deepagents create_deep_agent + skills/filesystem middleware)。

    model: 会话级模型覆盖(空=用 config 默认)
    enabled_tools: 启用的工具名集合(空=全部)。
    system_prompt: agent system prompt(空=用默认气动 prompt;§8 配置面传入)

    skills 接入(§4.6):SkillsMiddleware + FilesystemMiddleware 共用 DockerContainerBackend,
    指向【会话容器】的 /workspace/skills/。agent 的 read_file/ls 与 skills 发现路径空间统一。
    """
    s = get_settings()
    if not s.llm_api_key:
        raise ValueError("LLM_API_KEY 未设置(配 .env)")
    use_model = model or s.llm_model
    llm = ChatOpenAI(
        base_url=s.llm_base_url, api_key=s.llm_api_key, model=use_model,
        max_tokens=s.llm_max_tokens, temperature=0.3,
        streaming=True,  # token 级流式更稳(§2.3)
        # 暴露上下文窗口给 SummarizationMiddleware(create_deep_agent 默认挂):
        # 有 max_input_tokens 时走 fraction(trigger=85%/keep=10%);无则 170k fixed。
        profile={"max_input_tokens": s.llm_context_window},
    )
    # 注册内置工具(供工厂识别)
    from app.agent_runtime.tool_factory import register_builtin, load_tools
    register_builtin("run_aero_tool", run_aero_tool)
    register_builtin("run_sweep_in_sandbox", _sweep_with_confirm)
    register_builtin("run_in_sandbox", run_in_sandbox)

    # 工具加载(§8 工具选择 + 统一工具管理):
    #   enabled_tools 含内置名(run_aero_tool)+ 用户工具 id(tool_xxx)
    #   工厂按 type 实例化:内置直给 / python/bash→sandbox exec / web→HTTP / mcp→client
    #   显式配置(非 None):严格按 enabled_tools 加载(空 set = 该 agent 不要这些工具,
    #     如 CAD agent 配 tools=[] 不该带气动工具)。None=未指定,用气动默认。
    if enabled_tools is None:
        # 未指定(向后兼容):默认气动工具
        tools = [run_aero_tool, _sweep_with_confirm]
    else:
        # 显式配置(含空 set):严格按配置,不默认补气动
        tools = load_tools(list(enabled_tools)) if enabled_tools else []
    # system prompt(§8:配置面传入则用配置的,否则用默认气动)
    system = system_prompt or (
        "你是机翼气动优化助手。你能:\n"
        "1) 用 run_aero_tool 做单次气动分析(给定翼展/面积/迎角,返回CL/CDi/L_D);\n"
        "2) 用 run_sweep_in_sandbox 做展弦比扫描找最优升阻比(在隔离沙箱跑)。\n"
        "用户提需求时,先判断是否需要扫描;给出建议时附上数据支撑(具体数值)。\n"
        "气动常识:大展弦比降低诱导阻力、提升升阻比;椭圆分布 Oswald≈1。"
    )

    # —— skills/filesystem:经会话容器 backend(路径统一)——
    # 从当前 session 取 session_id(工具执行在同一进程全局)
    from app.agent_runtime.session_runner import get_current_session
    state = get_current_session()
    extra_kwargs = {}
    if state and state.session_id and state.container_name:
        # 仅在会话容器就绪时挂 skills(无容器=同步 POST /chat 路径,不挂)
        try:
            from app.sandbox_mgr.docker_backend import DockerContainerBackend
            from app.sandbox_mgr.manager import get_manager as _gm
            # observer 已在 session_runner._ensure_container_and_skills 按会话注册,
            # 单例 manager 按 session_id 路由,此处不再传 on_exec(旧单值已废弃)。
            mgr = _gm()
            backend = DockerContainerBackend(mgr, state.session_id)
            # 把 backend 传给 create_deep_agent:它会把默认的 FilesystemMiddleware 和
            # SkillsMiddleware 都接到【我的容器 backend】,路径空间统一(/workspace/skills/)。
            extra_kwargs["backend"] = backend
            # skills 指向容器内目录(会话启动时已同步);create_deep_agent 见 skills 自动加 SkillsMiddleware
            extra_kwargs["skills"] = ["/workspace/skills"]
            logger.info("build_agent 挂载 skills+filesystem backend(容器 %s, session=%s)",
                        state.container_name, state.session_id)
            # 容器就绪 → 挂 run_in_sandbox(执行工具),让 agent/子代理能跑脚本。
            # deepagents FilesystemMiddleware 只给 read/write/ls,无 exec;CAD 等
            # 需执行脚本(python cube.py)的 agent 必须有此工具。父 agent 有则
            # 子代理经 default_tools 继承(SubAgent 文档:未指定 tools 则继承父)。
            if run_in_sandbox not in tools:
                tools = [*tools, run_in_sandbox]
        except Exception as e:
            logger.warning("挂载 skills backend 失败(agent 仍可跑,但无 skill):%s", e)

    return create_deep_agent(
        model=llm,
        tools=tools,
        system_prompt=system,
        checkpointer=_checkpointer,
        **extra_kwargs,
    )


@tool
async def _sweep_with_confirm(area: float, ar_start: float, ar_end: float, ar_step: float) -> str:
    """run_sweep_in_sandbox 的确认包装(§5.4 工具前置确认)。
    调用前按会话模式检查是否需用户确认;需则暂停等决策,据结果执行/跳过。"""
    from app.agent_runtime.session_runner import get_current_session, registry
    from app.agent_runtime.guardrails import needs_confirm

    state = get_current_session()
    args = {"area": area, "ar_start": ar_start, "ar_end": ar_end, "ar_step": ar_step}
    # 无 session 上下文(如 POST /chat 同步调用)→ 用临时容器执行,不确认
    if state is None:
        import uuid
        ephemeral_sid = "eph_" + uuid.uuid4().hex[:12]
        try:
            return _run_sweep_raw(ephemeral_sid, **args)
        finally:
            try:
                get_manager().release(ephemeral_sid, destroy=True)
            except Exception:
                pass
    # 按模式判断是否需确认(用本工具的独立计数,避免与事件流计数时序冲突)
    state_sweep_count = getattr(state, "_sweep_count", 0)
    setattr(state, "_sweep_count", state_sweep_count + 1)
    if needs_confirm("run_sweep_in_sandbox", state.mode, state_sweep_count):
        result = await registry.request_confirm(state.session_id, "run_sweep_in_sandbox", args)
        if not result["approved"]:
            return "用户取消了此次扫描(可调整参数后重试)。"
        args = result["args"]  # 用户可能改了参数
    # 执行 + 失败捕获(§5.5):工具失败→interrupted,等用户 recover 决策
    try:
        return _run_sweep_raw(state.session_id, **args)
    except Exception as e:
        # 触发失败暂停:写 interrupted + 暂停等 recover 决策
        decision = await registry.request_failure_pause(
            state.session_id, "run_sweep_in_sandbox", f"{type(e).__name__}: {str(e)[:200]}")
        action = decision.get("action", "end")
        if action == "retry":
            return _run_sweep_raw(state.session_id, **args)  # 重试一次
        elif action == "skip":
            return f"扫描已跳过(此前失败:{str(e)[:80]})。请基于已有信息继续。"
        else:  # end:返回结束提示,让 agent 自然收尾→done(不 raise,避免再触发 interrupted)
            return "用户已选择结束本次操作。请简短确认即可。"


@tool
def run_in_sandbox(command: str) -> str:
    """在会话沙箱容器内执行 shell 命令(如运行 Python 脚本、装包、查看文件)。

    用于:执行写到 /workspace 的脚本(python script.py)、检查环境、
    运行建模/渲染命令等。命令在隔离的会话容器内跑,工作目录 /workspace。

    args:
      command: 要执行的 shell 命令(如 'python /workspace/scripts/cube.py')
    返回:命令的 stdout(末尾附 exit code);失败信息含 stderr。
    """
    from app.agent_runtime.session_runner import get_current_session
    state = get_current_session()
    if not state or not state.session_id:
        return "错误:无活跃会话沙箱(无法执行命令)"
    mgr = get_manager()
    try:
        r = mgr.exec(state.session_id, command, workdir="/workspace")
    except Exception as e:
        return f"执行异常: {e}"
    out = r.stdout or ""
    if r.stderr:
        out += f"\n[stderr]\n{r.stderr}"
    return f"{out}\n[exit {r.exit_code}]"


def _run_sweep_raw(session_id: str, area: float, ar_start: float, ar_end: float, ar_step: float) -> str:
    """实际执行 sandbox 扫描(会话级容器版)。

    session_id: 会话标识(决定用哪个容器);无会话上下文时传临时 id。
    exec observer 由 session_runner 按会话注册(manager 按 session_id 路由),此处不再传。
    """
    sweep_code = f"""
import sys; sys.path.insert(0, '/home/gem')
from llt import run_aero
best=None; rows=[]
ar={ar_start}
while ar <= {ar_end}+1e-9:
    span=({area}*ar)**0.5
    r=run_aero(span=span, area={area}, alpha_deg=3.0)
    rows.append((round(ar,2), round(r['L_D'],2), round(r['CL'],4)))
    if best is None or r['L_D']>best[1]: best=(round(ar,2), round(r['L_D'],2))
    ar+={ar_step}
for ar,ld,cl in rows: print(f'AR={{ar}} L/D={{ld}} CL={{cl}}')
print(f'OPTIMAL: AR={{best[0]}} L/D={{best[1]}}')
"""
    mgr = get_manager()
    mgr.acquire(session_id)  # 确保容器在(会话级,首条消息已起;临时路径在此起)
    # aerosandbox 已预装进自定义 sandbox 镜像(避免每次 pip install 编译耗时/OOM)。
    # 保留一行快速校验(预装则 instant,未预装则补装——降级兼容)。
    mgr.exec(session_id, "python -c 'import aerosandbox' 2>/dev/null || pip install --quiet aerosandbox numpy 2>&1 | tail -1", workdir="/tmp")
    mgr.put_file(session_id, "/home/gem/llt.py", _standalone_llt().encode())
    mgr.put_file(session_id, "/home/gem/sweep.py", sweep_code.encode())
    r = mgr.exec(session_id, "python /home/gem/sweep.py 2>&1 | grep -v Warning")
    return r.stdout if r.exit_code == 0 else f"扫描失败(exit {r.exit_code}): {r.stdout}"


def run(user_input: str, session_id: str = "") -> str:
    """运行一次 agent 会话(同步,POST /chat 用),返回最终文本。

    session_id:传入则关联 checkpointer/summarization thread_id(压缩历史正确落盘)。
    """
    agent = build_agent()
    final_text = ""
    config = {"configurable": {"thread_id": session_id}} if session_id else None
    for chunk in agent.stream({"messages": [("user", user_input)]}, config=config, stream_mode="values"):
        msg = chunk["messages"][-1]
        if hasattr(msg, "content") and msg.content and not isinstance(msg, str):
            role = getattr(msg, "type", "?")
            logger.info("[%s] %s", role, str(msg.content)[:120])
            if role == "ai" and not getattr(msg, "tool_calls", None):
                final_text = str(msg.content)
    return final_text or "(agent 未产生最终文本)"


async def astream_agent(user_input: str, model: str = "", enabled_tools: set | None = None, system_prompt: str = "", session_id: str = ""):
    """异步流式运行 agent(WebSocket §2.3 用),产出事件 dict。

    session_id: 会话标识 → LangGraph thread_id。配 checkpointer 后,
    同一 thread_id 的 messages 跨轮自动累积(上下文不丢)。

    产出的事件类型(供 WebSocket 推送):
      {"type":"token","content":"..."}        LLM 文本 token 增量
      {"type":"tool_start","name":"...","args":{...}}  工具调用开始
      {"type":"tool_end","name":"...","content":"..."} 工具结果
      {"type":"done"}                          本轮完成
      {"type":"error","message":"..."}         异常

    用 agent.astream(stream_mode=["messages","updates"]):
      - messages 拿 token 级流(AIMessageChunk)
      - updates 拿工具调用开始(AIMessage.tool_calls)与结果(ToolMessage)
    """
    from langchain_core.messages import AIMessageChunk, ToolMessage
    agent = build_agent(model=model, enabled_tools=enabled_tools, system_prompt=system_prompt)
    inputs = {"messages": [("user", user_input)]}
    # thread_id 关联 checkpointer:LangGraph 自动加载该 thread 的历史 messages,
    # 本轮只追加新用户消息(修复"对话无上下文"bug)。
    config = {"configurable": {"thread_id": session_id}} if session_id else None
    # filesystem 工具集合(deepagents FilesystemMiddleware 注入,前端单独成类)
    _FS_TOOLS = {"read_file", "ls", "write_file", "edit_file", "read_multiple_files", "str_replace"}
    # 记录上次 summarization 事件,检测变化(压缩发生时通知前端)
    last_se = None
    try:
        # 手动迭代 + per-chunk 超时:LLM gateway 流式响应偶尔挂起(收到 200 header
        # 但 body stream 不再来数据也不报错),导致 agent.astream() 无限等。
        # 用 wait_for 包 __anext__,90s 无新 chunk 即超时中断,避免静默卡死。
        _STREAM_TIMEOUT_S = 90
        aiter = agent.astream(inputs, config=config, stream_mode=["messages", "updates", "values"]).__aiter__()
        while True:
            try:
                mode, payload = await asyncio.wait_for(aiter.__anext__(), timeout=_STREAM_TIMEOUT_S)
            except StopAsyncIteration:
                break
            except asyncio.TimeoutError:
                logger.warning("astream chunk 超时 %ds(LLM 流式挂起),中断", _STREAM_TIMEOUT_S)
                yield {"type": "error", "message": f"LLM 响应超时({_STREAM_TIMEOUT_S}s 无数据),请重试"}
                return
            if mode == "messages":
                chunk, _meta = payload
                if isinstance(chunk, AIMessageChunk):
                    # reasoning 路径①:content block type=="reasoning"(标准 langchain 推理模型)
                    # reasoning 路径②:additional_kwargs.reasoning_content(DeepSeek 等非标准透传)
                    ak = getattr(chunk, "additional_kwargs", {}) or {}
                    rc = ak.get("reasoning_content") or ak.get("reasoning")
                    if rc:
                        yield {"type": "reasoning", "content": str(rc)}
                    # 区分 content block 类型:推理模型的 content 是 list(含 reasoning/text block)
                    if isinstance(chunk.content, list):
                        for block in chunk.content:
                            if not isinstance(block, dict):
                                continue
                            bt = block.get("type")
                            if bt == "reasoning":
                                r = block.get("reasoning") or block.get("text") or ""
                                if r:
                                    yield {"type": "reasoning", "content": str(r)}
                            elif bt == "text":
                                t = block.get("text", "")
                                if t:
                                    yield {"type": "token", "content": str(t)}
                    elif isinstance(chunk.content, str) and chunk.content:
                        yield {"type": "token", "content": chunk.content}
            elif mode == "values":
                # values 含完整 state;提取 deepagents 的 todos(计划进度,TodoListMiddleware)
                todos = payload.get("todos") if isinstance(payload, dict) else None
                if todos:
                    yield {"type": "todos", "todos": [
                        {"content": t.get("content", ""), "status": t.get("status", "pending")}
                        for t in todos
                    ]}
                # 检测上下文压缩(deepagents SummarizationMiddleware 写 _summarization_event)
                se = payload.get("_summarization_event") if isinstance(payload, dict) else None
                if se and se != last_se:
                    last_se = se
                    # summary_message 是 HumanMessage,取其 content 文本
                    sm = se.get("summary_message")
                    summary_text = ""
                    if sm is not None:
                        summary_text = str(getattr(sm, "content", sm) or "")[:300]
                    yield {
                        "type": "context_compacted",
                        "summary": summary_text,
                        "file_path": se.get("file_path", ""),
                    }
            elif mode == "updates":
                # updates 的 payload 是 {"node_name": node_output} dict(多 stream_mode 下)
                if isinstance(payload, dict):
                    node_outputs = payload
                else:  # 兼容旧版二元组
                    _node, node_outputs = payload
                for _node_name, node_output in (node_outputs.items() if isinstance(node_outputs, dict) else [payload]):
                    if not isinstance(node_output, dict):
                        continue
                    for m in node_output.get("messages", []):
                        if getattr(m, "tool_calls", None):  # 工具调用开始
                            for tc in m.tool_calls:
                                name = tc.get("name", "?")
                                yield {"type": "tool_start", "name": name, "args": tc.get("args", {}),
                                       "is_subagent": name == "task",
                                       "is_filesystem": name in _FS_TOOLS}
                        elif isinstance(m, ToolMessage):  # 工具结果
                            # 截断保留头尾:run_in_sandbox 的 [exit N] 在末尾,
                            # 纯 [:1000] 会把 exit code 截掉(熔断检测靠它)。
                            raw = str(m.content)
                            if len(raw) > 1000:
                                content = raw[:500] + "\n...[truncated]...\n" + raw[-400:]
                            else:
                                content = raw
                            yield {"type": "tool_end", "name": m.name, "content": content,
                                   "is_filesystem": m.name in _FS_TOOLS}
        yield {"type": "done"}
    except Exception as e:
        logger.exception("astream_agent 失败")
        yield {"type": "error", "message": str(e)}
