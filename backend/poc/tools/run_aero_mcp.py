"""
气动工具的 MCP server(动作型工具,§2.1)。
把 run_aero(基于 AeroSandbox VLM 的气动替身)暴露为 MCP 工具,
供 agent 经 MCP 协议调用。

运行:
  python run_aero_mcp.py          # stdio 传输(MCP 默认)
  python run_aero_mcp.py --http   # SSE 传输(供远程 agent 调用)

工具签名(供 agent 识别):
  run_aero(span, area, alpha_deg, cd0) -> {CL, CDi, CD_total, L_D, Oswald_e, AR}
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# 让本文件无论从哪运行都能 import 同目录的气动替身
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "aero"))
from llt import run_aero  # noqa: E402

# MCP 工具定义(schema 供 agent function-calling)
TOOL_DEF = {
    "name": "run_aero",
    "description": (
        "计算机翼气动特性(基于涡格法 VLM 的气动分析)。"
        "给定翼展、面积、迎角,返回升力系数 CL、诱导阻力 CDi、"
        "总阻力、升阻比 L/D、Oswald 效率因子、展弦比 AR。"
        "用于机翼气动优化(如最大化升阻比)。"
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "span":     {"type": "number", "description": "翼展 (m),如 10.0", "default": 10.0},
            "area":     {"type": "number", "description": "机翼面积 (m^2),如 10.0", "default": 10.0},
            "alpha_deg": {"type": "number", "description": "迎角 (deg),如 3.0", "default": 3.0},
            "cd0":      {"type": "number", "description": "寄生阻力系数,如 0.01", "default": 0.01},
        },
        "required": ["span", "area", "alpha_deg"],
    },
}


def call_tool(args: dict) -> dict:
    """执行 run_aero,带基础参数校验(§2.1 MCP 工具的 schema 校验价值)。"""
    try:
        span = float(args.get("span", 10.0))
        area = float(args.get("area", 10.0))
        alpha = float(args.get("alpha_deg", 3.0))
        cd0 = float(args.get("cd0", 0.01))
    except (TypeError, ValueError):
        return {"error": "参数必须为数值"}
    if span <= 0 or area <= 0:
        return {"error": "翼展和面积必须 > 0"}
    if not -10 <= alpha <= 30:
        return {"error": "迎角超出合理范围 (-10°~30°)"}
    return run_aero(span=span, area=area, alpha_deg=alpha, cd0=cd0)


# —— 下面是 MCP 协议适配层 ——
# V1 正式接入用 mcp 官方 SDK(FastMCP);POC 先提供:
#   1) 纯函数调用入口(call_tool)——供 agent 直接 import 或 sandbox 内调用
#   2) stdio MCP server——供 MCP host 通过标准协议调用
#   3) HTTP/SSE 入口占位——供远程 agent

def _run_stdio_mcp():
    """极简 stdio MCP server(POC)。V1 换 FastMCP 官方实现。"""
    try:
        from mcp.server import Server  # type: ignore
        from mcp.server.stdio import stdio_server  # type: ignore
        import asyncio
    except ImportError:
        print("[run_aero_mcp] mcp SDK 未安装,POC 仅暴露 call_tool 函数入口", file=sys.stderr)
        print("[run_aero_mcp] 可直接: from run_aero_mcp import call_tool, TOOL_DEF", file=sys.stderr)
        return

    server = Server("run-aero")

    @server.list_tools()
    async def list_tools():
        from mcp.types import Tool
        return [Tool(name=TOOL_DEF["name"], description=TOOL_DEF["description"],
                     inputSchema=TOOL_DEF["inputSchema"])]

    @server.call_tool()
    async def do_call(name, arguments):
        from mcp.types import TextContent
        if name != "run_aero":
            return [TextContent(type="text", text=json.dumps({"error": f"未知工具 {name}"}))]
        result = call_tool(arguments or {})
        return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False))]

    async def main():
        async with stdio_server() as (r, w):
            await server.run(r, w, server.create_initialization_options())
    asyncio.run(main())


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        # 不依赖 MCP,直接验证工具调用
        print("=== run_aero 工具自测(AR=10, alpha=3°) ===")
        print(json.dumps(call_tool({"span": 10, "area": 10, "alpha_deg": 3}), indent=2, ensure_ascii=False))
    elif "--http" in sys.argv:
        print("[run_aero_mcp] HTTP/SSE 入口 V1 再实现(POC 用 stdio 或直接函数调用)")
    else:
        _run_stdio_mcp()
