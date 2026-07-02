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
from langgraph.prebuilt import create_react_agent

from app.config import get_settings
from app.tools.aero import run_aero
from app.sandbox_mgr.manager import get_manager

logger = logging.getLogger("aero_agent")


@tool
def run_sweep_in_sandbox(area: float, ar_start: float, ar_end: float, ar_step: float) -> str:
    """在沙箱内跑展弦比参数扫描,找最大升阻比。
    会动态生成参数扫描代码并在隔离沙箱内执行(决策#4: agent写代码)。
    参数: area固定面积(平米), ar_start/ar_end/ar_step 展弦比范围与步长。
    返回扫描结果与最优展弦比。"""
    settings = get_settings()
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
    mgr = get_manager(base_url=settings.sandbox_base_url)
    # 装 aerosandbox + 拷入独立 run_aero 脚本 + 扫描脚本(均经 HTTP API)
    mgr.exec("pip install --quiet aerosandbox numpy 2>&1 | tail -1", workdir="/tmp")
    mgr.put_file("/home/gem/llt.py", _standalone_llt().encode())
    mgr.put_file("/home/gem/sweep.py", sweep_code.encode())
    r = mgr.exec("python /home/gem/sweep.py 2>&1 | grep -v Warning")
    return r.stdout if r.exit_code == 0 else f"扫描失败(exit {r.exit_code}): {r.stdout}"


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


def build_agent():
    """构建气动优化 agent(扁平 ReAct 循环)。"""
    s = get_settings()
    if not s.llm_api_key:
        raise ValueError("LLM_API_KEY 未设置(配 .env)")
    llm = ChatOpenAI(
        base_url=s.llm_base_url, api_key=s.llm_api_key, model=s.llm_model,
        max_tokens=s.llm_max_tokens, temperature=0.3,
        streaming=True,  # token 级流式更稳(§2.3)
    )
    system = (
        "你是机翼气动优化助手。你能:\n"
        "1) 用 run_aero_tool 做单次气动分析(给定翼展/面积/迎角,返回CL/CDi/L_D);\n"
        "2) 用 run_sweep_in_sandbox 做展弦比扫描找最优升阻比(在隔离沙箱跑)。\n"
        "用户提需求时,先判断是否需要扫描;给出建议时附上数据支撑(具体数值)。\n"
        "气动常识:大展弦比降低诱导阻力、提升升阻比;椭圆分布 Oswald≈1。"
    )
    return create_react_agent(llm, [run_aero_tool, _sweep_with_confirm], prompt=system)


@tool
async def _sweep_with_confirm(area: float, ar_start: float, ar_end: float, ar_step: float) -> str:
    """run_sweep_in_sandbox 的确认包装(§5.4 工具前置确认)。
    调用前按会话模式检查是否需用户确认;需则暂停等决策,据结果执行/跳过。"""
    from app.agent_runtime.session_runner import get_current_session, registry
    from app.agent_runtime.guardrails import needs_confirm

    state = get_current_session()
    args = {"area": area, "ar_start": ar_start, "ar_end": ar_end, "ar_step": ar_step}
    # 无 session 上下文(如 POST /chat 同步调用)→ 直接执行,不确认
    if state is None:
        return _run_sweep_raw(**args)
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
        return _run_sweep_raw(**args)
    except Exception as e:
        # 触发失败暂停:写 interrupted + 暂停等 recover 决策
        decision = await registry.request_failure_pause(
            state.session_id, "run_sweep_in_sandbox", f"{type(e).__name__}: {str(e)[:200]}")
        action = decision.get("action", "end")
        if action == "retry":
            return _run_sweep_raw(**args)  # 重试一次(工具内重试)
        elif action == "skip":
            return f"扫描已跳过(此前失败:{str(e)[:80]})。请基于已有信息继续。"
        else:  # end:返回结束提示,让 agent 自然收尾→done(不 raise,避免再触发 interrupted)
            return "用户已选择结束本次操作。请简短确认即可。"


def _run_sweep_raw(area: float, ar_start: float, ar_end: float, ar_step: float) -> str:
    """实际执行 sandbox 扫描(原 run_sweep_in_sandbox 逻辑,同步)。"""
    settings = get_settings()
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
    mgr = get_manager(base_url=settings.sandbox_base_url)
    mgr.exec("pip install --quiet aerosandbox numpy 2>&1 | tail -1", workdir="/tmp")
    mgr.put_file("/home/gem/llt.py", _standalone_llt().encode())
    mgr.put_file("/home/gem/sweep.py", sweep_code.encode())
    r = mgr.exec("python /home/gem/sweep.py 2>&1 | grep -v Warning")
    return r.stdout if r.exit_code == 0 else f"扫描失败(exit {r.exit_code}): {r.stdout}"


def run(user_input: str) -> str:
    """运行一次 agent 会话(同步,POST /chat 用),返回最终文本。"""
    agent = build_agent()
    final_text = ""
    for chunk in agent.stream({"messages": [("user", user_input)]}, stream_mode="values"):
        msg = chunk["messages"][-1]
        if hasattr(msg, "content") and msg.content and not isinstance(msg, str):
            role = getattr(msg, "type", "?")
            logger.info("[%s] %s", role, str(msg.content)[:120])
            if role == "ai" and not getattr(msg, "tool_calls", None):
                final_text = str(msg.content)
    return final_text or "(agent 未产生最终文本)"


async def astream_agent(user_input: str):
    """异步流式运行 agent(WebSocket §2.3 用),产出事件 dict。

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
    agent = build_agent()
    inputs = {"messages": [("user", user_input)]}
    try:
        async for mode, payload in agent.astream(inputs, stream_mode=["messages", "updates"]):
            if mode == "messages":
                chunk, _meta = payload
                if isinstance(chunk, AIMessageChunk):
                    if chunk.content:  # 文本 token 增量
                        yield {"type": "token", "content": str(chunk.content)}
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
                                yield {"type": "tool_start", "name": tc.get("name", "?"), "args": tc.get("args", {})}
                        elif isinstance(m, ToolMessage):  # 工具结果
                            yield {"type": "tool_end", "name": m.name, "content": str(m.content)[:1000]}
        yield {"type": "done"}
    except Exception as e:
        logger.exception("astream_agent 失败")
        yield {"type": "error", "message": str(e)}
