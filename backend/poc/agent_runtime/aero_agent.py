"""
气动优化 Agent 内核(扁平型,§2 决策)。

用 LangGraph 实现"LLM + function calling 自主循环":
  - LLM 自主决定调用 run_aero(单次气动分析)还是 run_sweep_in_sandbox(参数扫描)
  - 工具结果回灌,LLM 继续推理,直到给出最终气动建议
  - 体现决策 #4(agent 可触发在 sandbox 内跑代码)和 #12(MCP 工具/动作型)

边界(§2.2):agent_runtime 只通过工具接口调外部,不依赖业务层。
"""
from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path
from typing import Annotated

# 让本模块能 import 同级 poc 代码
_POC = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_POC / "aero"))
sys.path.insert(0, str(_POC / "sandbox"))

from llt import run_aero  # noqa: E402
from manager import SandboxManager  # noqa: E402
from langchain_openai import ChatOpenAI  # noqa: E402
from langchain_core.tools import tool  # noqa: E402
from langgraph.prebuilt import create_react_agent  # noqa: E402

logger = logging.getLogger("aero_agent")


def _cfg():
    """从环境变量读 LLM 配置(不硬编码)。"""
    return {
        "base_url": os.getenv("LLM_BASE_URL", "http://192.168.2.220:3000/v1"),
        "api_key": os.getenv("LLM_API_KEY", ""),
        "model": os.getenv("LLM_MODEL", "deepseek-v4-flash"),
        "max_tokens": int(os.getenv("LLM_MAX_TOKENS", "4000")),
    }


# —— 工具定义(§2.1 动作型;agent 自主选择调用)——
@tool
def run_aero_tool(span: float, area: float, alpha_deg: float) -> dict:
    """计算机翼气动特性(升力系数CL、诱导阻力CDi、升阻比L_D、Oswald效率)。
    参数: span翼展(米), area机翼面积(平方米), alpha_deg迎角(度)。
    用于单次气动分析。"""
    r = run_aero(span=span, area=area, alpha_deg=alpha_deg)
    return {k: v for k, v in r.items()}


@tool
def run_sweep_in_sandbox(area: float, ar_start: float, ar_end: float, ar_step: float) -> str:
    """在沙箱内跑展弦比参数扫描,找最大升阻比。
    会动态生成一段参数扫描代码并在隔离沙箱内执行(决策#4: agent写代码)。
    参数: area固定面积(平米), ar_start/ar_end/ar_step 展弦比范围与步长。
    返回扫描结果与最优展弦比。"""
    # agent 现写的扫描脚本(模拟 agent 动态生成;实际由 LLM 生成更灵活)
    sweep_code = f"""
import sys; sys.path.insert(0, '/workspace')
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
    mgr = SandboxManager(image=os.getenv("SANDBOX_IMAGE", "python:3.11-slim"))
    sid = f"sweep-{os.getpid()}"
    try:
        mgr.acquire(sid, gpu=os.getenv("SANDBOX_GPU", "false") == "true")
        # 装 aerosandbox(沙箱内)
        mgr.exec(sid, "pip install --quiet aerosandbox numpy", workdir="/tmp")
        # 拷入气动替身 + 扫描脚本
        mgr.put_file(sid, "/workspace/llt.py", (_POC / "aero/llt.py").read_bytes())
        mgr.put_file(sid, "/workspace/sweep.py", sweep_code.encode())
        r = mgr.exec(sid, "cd /workspace && python sweep.py 2>&1 | grep -v Warning")
        return r.stdout if r.exit_code == 0 else f"扫描失败(exit {r.exit_code}): {r.stderr}"
    finally:
        mgr.release(sid, destroy=True)


def build_agent():
    """构建气动优化 agent(扁平 ReAct 循环)。"""
    cfg = _cfg()
    if not cfg["api_key"]:
        raise ValueError("LLM_API_KEY 未设置,请配 .env 或环境变量")
    llm = ChatOpenAI(
        base_url=cfg["base_url"], api_key=cfg["api_key"], model=cfg["model"],
        max_tokens=cfg["max_tokens"], temperature=0.3,
    )
    system = (
        "你是机翼气动优化助手。你能:\n"
        "1) 用 run_aero_tool 做单次气动分析(给定翼展/面积/迎角,返回CL/CDi/L_D);\n"
        "2) 用 run_sweep_in_sandbox 做展弦比扫描找最优升阻比(在隔离沙箱跑)。\n"
        "用户提需求时,先判断是否需要扫描;给出建议时附上数据支撑(具体数值)。\n"
        "气动常识:大展弦比降低诱导阻力、提升升阻比;椭圆分布 Oswald≈1。"
    )
    return create_react_agent(llm, [run_aero_tool, run_sweep_in_sandbox], prompt=system)


def run(user_input: str) -> str:
    """运行一次 agent 会话,返回最终文本输出。"""
    agent = build_agent()
    # 流式收集(事件流 §2.5 的雏形)
    final_text = ""
    for chunk in agent.stream({"messages": [("user", user_input)]}, stream_mode="values"):
        msg = chunk["messages"][-1]
        if hasattr(msg, "content") and msg.content and isinstance(msg, str) is False:
            role = getattr(msg, "type", "?")
            logger.info("[%s] %s", role, str(msg.content)[:120])
            if role == "ai" and not getattr(msg, "tool_calls", None):
                final_text = str(msg.content)
    return final_text or "(agent 未产生最终文本)"


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    # 从 .env 读配置(若用 dotenv)
    try:
        from dotenv import load_dotenv
        load_dotenv(_POC / ".env")
    except ImportError:
        pass
    q = sys.argv[1] if len(sys.argv) > 1 else "我想最大化升阻比,面积固定10平米,帮我找最优展弦比(扫6到14)"
    print("=" * 60)
    print("用户:", q)
    print("=" * 60)
    out = run(q)
    print("\n" + "=" * 60)
    print("agent 最终建议:")
    print("=" * 60)
    print(out)
