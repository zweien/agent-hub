"""示例 MCP server(math 工具),用于 MCP 集成测试 + 作为用户配置 MCP 工具的参考。

跑法(stdio):python mcp_math.py
平台接入:在工具管理建 type=mcp 的工具,config.command="python", config.args=["本文件路径"]
"""
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("math")


@mcp.tool()
def add(a: float, b: float) -> float:
    """两数相加,返回和。"""
    return a + b


@mcp.tool()
def multiply(a: float, b: float) -> float:
    """两数相乘,返回积。"""
    return a * b


if __name__ == "__main__":
    mcp.run(transport="stdio")
