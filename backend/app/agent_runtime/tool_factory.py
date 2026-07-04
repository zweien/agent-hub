"""统一工具工厂(§2.1 分层 + grilling 工具管理决策)。

把异构工具声明(PG Tool 表)实例化成 agent 可 function-call 的 BaseTool。
agent 不感知工具类型差异——工厂按 type 生成统一 BaseTool。

四种 adapter:
  - python/bash:把 config.code 写进会话 sandbox 容器 exec(安全隔离,绝不后端进程跑)
  - web:后端发 HTTP 转发(config 声明 URL/方法/鉴权)
  - mcp:后端起 MCP client 连 server,拉工具按 name 过滤

load_tools(tool_refs, session_id) 是入口:
  tool_refs 含内置工具名(run_aero_tool)+ 用户工具 id(tool_xxx)。
"""
from __future__ import annotations

import json
import logging
import urllib.request
from typing import Any

from langchain_core.tools import StructuredTool, BaseTool
from pydantic import create_model

from app.db import SessionLocal
from app.models.tool import Tool

logger = logging.getLogger("tool_factory")

# —— 内置工具:模块级注册(不进 DB,工厂直接给)——
# 由 aero_agent 注册(避免循环导入)
_BUILTIN_TOOLS: dict[str, BaseTool] = {}


def register_builtin(name: str, tool: BaseTool) -> None:
    """注册内置工具(build_agent 启动时调)。"""
    _BUILTIN_TOOLS[name] = tool


def _schema_to_pydantic(name: str, schema: dict) -> type:
    """把 JSON Schema 转 pydantic model(StructuredTool 的 args_schema)。

    简化:只处理 type=number/string/integer + description。复杂 schema 回退到全 str。
    """
    if not schema or "properties" not in schema:
        # 无 schema → 无参工具
        return create_model(f"{name}_args")
    props = schema["properties"]
    required = set(schema.get("required", []))
    type_map = {"number": float, "integer": int, "string": str}
    fields: dict[str, Any] = {}
    for fname, fspec in props.items():
        ftype = type_map.get(fspec.get("type", "string"), str)
        default = ... if fname in required else None
        fields[fname] = (ftype, default)
    try:
        return create_model(f"{name}_args", **fields)
    except Exception:
        # 回退:全 string
        return create_model(f"{name}_args", **{n: (str, ...) for n in props})


# —— python/bash adapter(在会话容器 exec)——
def _make_script_tool(tool: Tool, session_id_getter) -> BaseTool:
    """生成在会话 sandbox 容器内执行脚本的 BaseTool。

    session_id_getter: 无参 callable,返回当前 session_id(运行时取,非构建时)。
    """
    cfg = tool.config or {}
    code = cfg.get("code", "")
    workdir = cfg.get("workdir", "/tmp")
    is_python = tool.type == "python"
    args_schema = _schema_to_pydantic(tool.name, tool.params_schema or {})

    def _run(**kwargs) -> str:
        from app.sandbox_mgr.manager import get_manager
        sid = session_id_getter()
        if not sid:
            return "错误:无活跃会话(脚本工具需要会话容器)"
        mgr = get_manager()
        # 把参数注入脚本环境(python:赋值变量;bash:环境变量)
        param_setup = ""
        if is_python:
            for k, v in kwargs.items():
                param_setup += f"{k} = {v!r}\n"
            full_code = param_setup + "\n" + code
        else:
            # bash:参数作环境变量
            env_prefix = " ".join(f'{k}="{v}"' for k, v in kwargs.items())
            full_code = env_prefix + " bash -lc " + repr(code) if False else code
        # 写脚本进容器 + 执行
        script_path = f"{workdir}/{tool.name}.{'py' if is_python else 'sh'}"
        mgr.put_file(sid, script_path, full_code.encode("utf-8"))
        cmd = f"python3 {script_path}" if is_python else f"bash {script_path}"
        try:
            r = mgr.exec(sid, cmd, workdir=workdir)
            return r.stdout.strip() if r.exit_code == 0 else f"执行失败(exit {r.exit_code}): {r.stderr or r.stdout}"
        except Exception as e:
            return f"执行异常: {e}"

    return StructuredTool.from_function(
        func=_run, name=tool.name, description=tool.description,
        args_schema=args_schema,
    )


# —— web adapter(后端发 HTTP)——
def _make_web_tool(tool: Tool) -> BaseTool:
    """生成发 HTTP 请求的 BaseTool。"""
    cfg = tool.config or {}
    url = cfg.get("url", "")
    method = cfg.get("method", "GET").upper()
    headers = cfg.get("headers", {})
    auth_header = cfg.get("auth_header")  # 形如 "Bearer xxx" 或从 config 读
    param_mapping = cfg.get("param_mapping", {})  # {参数名: 目标(path/query/body)}
    args_schema = _schema_to_pydantic(tool.name, tool.params_schema or {})

    def _run(**kwargs) -> str:
        if not url:
            return "错误:web 工具未配置 url"
        # 简化:所有参数作为 query(GET)或 JSON body(其它)
        req_headers = dict(headers)
        if auth_header:
            req_headers["Authorization"] = auth_header
        body = None
        req_url = url
        if method == "GET":
            if kwargs:
                qs = "&".join(f"{k}={v}" for k, v in kwargs.items())
                req_url = f"{url}{'&' if '?' in url else '?'}{qs}"
        else:
            req_headers["Content-Type"] = "application/json"
            body = json.dumps(kwargs).encode()
        req = urllib.request.Request(req_url, data=body, headers=req_headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read().decode("utf-8", "replace")[:4000]
        except Exception as e:
            return f"HTTP 请求失败: {e}"

    return StructuredTool.from_function(
        func=_run, name=tool.name, description=tool.description,
        args_schema=args_schema,
    )


# —— mcp adapter(后端起 MCP client)——
def _make_mcp_tools(tool: Tool) -> list[BaseTool]:
    """连 MCP server,拉工具列表。返回多个 BaseTool(MCP server 可能暴露多个工具)。

    需 langchain-mcp-adapters。装不上则跳过(降级)。
    config 格式:
      stdio: {"transport":"stdio","command":"python","args":["server.py"]}
      http:  {"transport":"streamable_http","server_url":"http://..."}
    tool_filter: 可选,只取这些名字的工具。
    """
    import asyncio
    cfg = tool.config or {}
    tool_filter = cfg.get("tool_filter")
    try:
        from langchain_mcp_adapters.client import MultiServerMCPClient
    except ImportError:
        logger.warning("MCP 工具 %s 跳过:langchain-mcp-adapters 未安装", tool.name)
        return []

    # 构造 connections 参数(按 transport 类型)
    connections: dict = {}
    transport = cfg.get("transport", "stdio")
    if transport == "streamable_http" or cfg.get("server_url"):
        connections[tool.name] = {
            "transport": "streamable_http",
            "url": cfg.get("server_url", ""),
        }
    elif transport == "stdio" or cfg.get("command") or cfg.get("server_command"):
        # server_command 兼容旧格式(命令 + 参数分离)
        cmd = cfg.get("command") or (cfg.get("server_command") or [])
        if isinstance(cmd, list):
            command, args = (cmd[0] if cmd else ""), (cmd[1:] if len(cmd) > 1 else [])
        else:
            command, args = cmd, (cfg.get("args") or [])
        connections[tool.name] = {
            "transport": "stdio",
            "command": command,
            "args": args,
        }
    else:
        logger.warning("MCP 工具 %s 无 command/server_url", tool.name)
        return []

    async def _load():
        client = MultiServerMCPClient(connections)
        tools = await client.get_tools()
        if tool_filter:
            tools = [t for t in tools if t.name in tool_filter]
        return tools

    try:
        # build_agent 在 async 上下文里跑(astream_agent 内),用 ensure_future 安全获取工具
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop and loop.is_running():
            # 已在 event loop 内(正常情况)——同步等待不可行,用新线程跑
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as ex:
                tools = ex.submit(lambda: asyncio.run(_load())).result(timeout=30)
        else:
            tools = asyncio.run(_load())
        # 包一层:把 MCP 原始返回(可能含 text content 块)解包成字符串,给 agent 干净结果
        wrapped = []
        for t in tools:
            wrapped.append(_unwrap_mcp_tool(t, tool.name))
        logger.info("MCP 工具 %s 加载 %d 个", tool.name, len(wrapped))
        return wrapped
    except Exception as e:
        logger.warning("MCP 工具 %s 加载失败:%s", tool.name, e)
        return []


def _unwrap_mcp_tool(tool: BaseTool, source: str) -> BaseTool:
    """包一层:把 MCP 返回的 content 块列表解包成干净字符串。

    MCP 原始返回形如 [{type:'text', text:'7.0', id:'...'}],agent 需要干净的 '7.0'。
    用 StructuredTool.from_function 重建工具(而非 monkey-patch _arun,会丢签名)。
    """
    def _unwrap(result):
        if isinstance(result, list):
            texts = []
            for item in result:
                if isinstance(item, dict) and item.get("type") == "text":
                    texts.append(item.get("text", ""))
                elif isinstance(item, str):
                    texts.append(item)
            return "\n".join(texts) if texts else str(result)
        return result

    # 同步包装:用公共 invoke API(避免直接调 _run/_arun 的签名坑)
    def _sync_run(**kwargs):
        return _unwrap(tool.invoke(kwargs))

    # 异步包装:用公共 ainvoke API(config 由 langgraph 框架管理)
    async def _async_run(**kwargs):
        return _unwrap(await tool.ainvoke(kwargs))

    return StructuredTool.from_function(
        func=_sync_run,
        coroutine=_async_run,
        name=tool.name,
        description=tool.description,
        args_schema=getattr(tool, "args_schema", None),
    )


# —— 入口:加载工具 ——
def load_tools(tool_refs: list[str], session_id_getter=None) -> list[BaseTool]:
    """把工具引用列表(内置名 + tool_id)实例化成 BaseTool 列表。

    tool_refs: ["run_aero_tool", "tool_xxx", ...]
    session_id_getter: 无参 callable 返回当前 session_id(脚本工具运行时用)
    返回:BaseTool 列表(去重)
    """
    if not session_id_getter:
        def session_id_getter():
            from app.agent_runtime.session_runner import get_current_session
            s = get_current_session()
            return s.session_id if s else None

    result: list[BaseTool] = []
    seen_names: set[str] = set()
    user_ids: list[str] = []

    # 第一遍:内置工具直接给 + 收集用户工具 id
    for ref in tool_refs:
        if ref in _BUILTIN_TOOLS:
            t = _BUILTIN_TOOLS[ref]
            if ref not in seen_names:
                result.append(t)
                seen_names.add(ref)
        elif ref.startswith("tool_"):
            user_ids.append(ref)
        else:
            logger.warning("未知工具引用 %s(既非内置也非 tool_ id)", ref)

    # 第二遍:从 DB 加载用户工具
    if user_ids:
        db = SessionLocal()
        try:
            tools = db.query(Tool).filter(Tool.id.in_(user_ids)).all()
            for t in tools:
                if t.name in seen_names:
                    continue
                try:
                    if t.type in ("python", "bash"):
                        result.append(_make_script_tool(t, session_id_getter))
                    elif t.type == "web":
                        result.append(_make_web_tool(t))
                    elif t.type == "mcp":
                        result.extend(_make_mcp_tools(t))
                    else:
                        logger.warning("工具 %s 未知 type %s", t.name, t.type)
                    seen_names.add(t.name)
                except Exception as e:
                    logger.warning("工具 %s 实例化失败:%s", t.name, e)
        finally:
            db.close()
    return result
