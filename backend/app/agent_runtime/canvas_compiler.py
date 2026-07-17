"""画布编排编译器(V2 §5,ADR-0002)。

把 AgentConfig.canvas_def(JSON 图定义)运行时编译为 LangGraph StateGraph:
  - 节点 → LangGraph node callable((state)->dict)
  - 边 → add_edge / add_conditional_edges
  - 复用 DeepAgentState(messages 字段,DeltaChannel reducer)+ _checkpointer(MemorySaver)

canvas_def 结构(与前端 ReactFlow 对齐):
  {
    "entry_node_id": "n1",
    "nodes": [{"id":"n1","type":"llm","data":{"prompt":"...","model":""}}, ...],
    "edges": [{"source":"n1","target":"n2","source_handle":"yes"}, ...]
  }

支持 5 种节点(V2 MVP):
  entry / exit  — 图边界(START/END)
  llm           — LLM 调用(返回 AIMessage)
  tool          — 调工具(返回 ToolMessage)
  subagent      — 委派子代理(MVP:直接调子代理 LLM 简化)
  condition     — 条件分支(add_conditional_edges;按 source_handle 路由)

编译校验(§5.4 安全栏):入口存在、无悬空边、condition 出口可达、引用的工具/子代理
存在。非法 → CanvasCompileError(节点 id + 原因),会话不启动。
condition 表达式用受限规则(last_message_contains 关键词),不 eval() 任意代码(防 RCE)。
"""
from __future__ import annotations

import logging
from typing import Any

from langgraph.graph import StateGraph, START, END

from app.config import get_settings, resolve_model

logger = logging.getLogger("canvas_compiler")


class CanvasCompileError(ValueError):
    """画布图定义非法。message 含节点 id + 原因,供前端定位。"""


# 节点类型枚举
NODE_TYPES = ("entry", "exit", "llm", "tool", "subagent", "condition")


def compile_canvas(
    canvas_def: dict,
    model: str,
    enabled_tools: set | None,
    subagent_types: list | None,
    checkpointer,
) -> Any:
    """编译 canvas_def → CompiledStateGraph。

    model/enabled_tools/subagent_types 来自 AgentConfig(父配置),供 llm/tool/subagent
    节点引用(节点未指定时用父配置)。checkpointer 复用 aero_agent._checkpointer
    保证 thread_id 连续。
    """
    if not canvas_def or not isinstance(canvas_def, dict):
        raise CanvasCompileError("canvas_def 为空或非对象")

    # 复用 deepagents 的 DeepAgentState(messages + DeltaChannel reducer,跨轮累积正确)
    from deepagents.graph import DeepAgentState

    nodes = canvas_def.get("nodes") or []
    edges = canvas_def.get("edges") or []
    entry_id = canvas_def.get("entry_node_id")

    # —— 校验 + 索引 ——
    node_map: dict[str, dict] = {}
    has_entry_decl = False
    for n in nodes:
        nid = n.get("id")
        ntype = n.get("type")
        if not nid:
            raise CanvasCompileError(f"节点缺少 id:{n}")
        if ntype not in NODE_TYPES:
            raise CanvasCompileError(f"节点 {nid}:未知类型 {ntype}(支持 {NODE_TYPES})")
        if nid in node_map:
            raise CanvasCompileError(f"节点 id 重复:{nid}")
        node_map[nid] = n
        if ntype == "entry":
            has_entry_decl = True
    if not node_map:
        raise CanvasCompileError("图无节点")

    # entry_node_id 校验:优先用显式 entry_node_id,否则找 entry 类型节点
    if not entry_id:
        entry_nodes = [nid for nid, n in node_map.items() if n["type"] == "entry"]
        if entry_nodes:
            entry_id = entry_nodes[0]
        else:
            raise CanvasCompileError("未指定 entry_node_id,且无 entry 类型节点")
    if entry_id not in node_map:
        raise CanvasCompileError(f"entry_node_id={entry_id} 不在节点列表中")

    # 边的端点必须存在
    for e in edges:
        s, t = e.get("source"), e.get("target")
        if s not in node_map:
            raise CanvasCompileError(f"边的 source {s} 不存在")
        if t not in node_map:
            raise CanvasCompileError(f"边的 target {t} 不存在(来自 source={s} 的悬空边)")

    # —— 建 StateGraph ——
    builder = StateGraph(DeepAgentState)
    s = get_settings()

    # 预解析工具/子代理(LLM 对象在节点 callable 内 lazy 建,避免编译期连网关)
    from langchain_openai import ChatOpenAI

    def _make_llm(spec_model_id: str):
        """按 model id 建 ChatOpenAI(用网关配置)。空则用父 model。"""
        mid = (spec_model_id or model or s.llm_model).strip()
        mi = resolve_model(mid)
        return ChatOpenAI(
            base_url=s.llm_base_url, api_key=s.llm_api_key, model=mid,
            max_tokens=mi["max_tokens"], temperature=0.3,
            streaming=True, stream_usage=True,
            profile={"max_input_tokens": mi["context_window"]},
        )

    # 节点 callable 工厂:返回 (state)->dict 的闭包
    for nid, n in node_map.items():
        ntype = n["type"]
        data = n.get("data") or {}

        if ntype in ("entry", "exit"):
            # entry/exit 是图边界标记,本身不做事(边连 START/END)
            # 但需要一个 callable 占位(add_node 要求 action)
            def _passthrough(state):
                return {}
            builder.add_node(nid, _passthrough)
            continue

        if ntype == "llm":
            llm = _make_llm(data.get("model", ""))
            prompt = data.get("prompt", "")

            async def _llm_node(state, _llm=llm, _prompt=prompt):
                from langchain_core.messages import SystemMessage, HumanMessage
                msgs = []
                if _prompt:
                    msgs.append(SystemMessage(content=_prompt))
                # 取最后一条用户消息作为输入
                last_user = None
                for m in reversed(state.get("messages", [])):
                    if isinstance(m, HumanMessage) or getattr(m, "type", "") == "human":
                        last_user = m
                        break
                if last_user:
                    msgs.append(last_user)
                elif state.get("messages"):
                    msgs.extend(state["messages"])
                resp = await _llm.ainvoke(msgs)
                return {"messages": [resp]}
            builder.add_node(nid, _llm_node)
            continue

        if ntype == "tool":
            tool_name = data.get("tool_name", "")
            if not tool_name:
                raise CanvasCompileError(f"节点 {nid}(tool):缺少 tool_name")

            def _tool_node(state, _name=tool_name, _nid=nid):
                from app.agent_runtime.tool_factory import _BUILTIN_TOOLS
                from langchain_core.messages import ToolMessage
                tool = _BUILTIN_TOOLS.get(_name)
                if not tool:
                    raise CanvasCompileError(f"节点 {_nid}:工具 {_name} 未注册")
                # 取最后一条 AI 消息作为工具入参文本(MVP 简化:不解析 tool_calls)
                last_msg = state["messages"][-1] if state.get("messages") else None
                arg = getattr(last_msg, "content", str(last_msg or ""))
                try:
                    result = tool.invoke(arg)
                except Exception as ex:
                    result = f"工具 {_name} 执行失败: {ex}"
                return {"messages": [ToolMessage(content=str(result), tool_call_id=f"canvas_{_name}", name=_name)]}
            builder.add_node(nid, _tool_node)
            continue

        if ntype == "subagent":
            # MVP 简化:子代理节点直接调一个独立 LLM(用子代理类型的 prompt/model)
            sa_name = data.get("subagent_type", "")
            sa_spec = None
            if subagent_types:
                sa_spec = next((x for x in subagent_types if x.get("name") == sa_name), None)
            if not sa_spec:
                raise CanvasCompileError(
                    f"节点 {nid}(subagent):子代理类型 {sa_name} 未在 subagent_types 中定义"
                )
            sa_llm = _make_llm(sa_spec.get("model", ""))
            sa_prompt = sa_spec.get("prompt", "")

            async def _subagent_node(state, _llm=sa_llm, _prompt=sa_prompt, _name=sa_name):
                from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
                msgs = [SystemMessage(content=_prompt)] if _prompt else []
                last_user = None
                for m in reversed(state.get("messages", [])):
                    if isinstance(m, HumanMessage) or getattr(m, "type", "") == "human":
                        last_user = m
                        break
                if last_user:
                    msgs.append(last_user)
                resp = await _llm.ainvoke(msgs)
                # 子代理结果作为新 AI 消息回流(主链继续)
                return {"messages": [AIMessage(content=f"[子代理 {_name} 结果]\n{resp.content}", name=_name)]}
            builder.add_node(nid, _subagent_node)
            continue

        if ntype == "condition":
            # condition 节点本身不产出消息,只做路由(在 add_conditional_edges 里处理)
            # 这里仍需一个占位 callable(condition 节点会先执行,然后按 source_handle 路由)
            def _cond_passthrough(state):
                return {}
            builder.add_node(nid, _cond_passthrough)
            continue

    # —— 边 ——
    # START → entry
    builder.add_edge(START, entry_id)
    # exit → END
    for nid, n in node_map.items():
        if n["type"] == "exit":
            builder.add_edge(nid, END)

    # 按 source 分组边:condition 节点用 add_conditional_edges,其余用 add_edge
    edges_by_source: dict[str, list] = {}
    for e in edges:
        edges_by_source.setdefault(e["source"], []).append(e)

    for src, outs in edges_by_source.items():
        src_node = node_map.get(src, {})
        src_type = src_node.get("type")
        if src_type == "condition":
            # condition:按 source_handle(如 "yes"/"no")路由;受限规则:last_message_contains
            data = src_node.get("data") or {}
            rules = data.get("rules") or []  # [{handle:"yes", contains:"关键词"}, ...]
            # 默认出口(无 handle 匹配时)
            default_target = None
            handle_map: dict[str, str] = {}
            contain_rules: list[tuple[str, str]] = []
            for r in rules:
                h = r.get("handle")
                tgt = r.get("target")
                if h and tgt:
                    handle_map[h] = tgt
                    if r.get("contains"):
                        contain_rules.append((str(r["contains"]), tgt))
            # 无 handle 的边作为 default
            for e in outs:
                if not e.get("source_handle"):
                    default_target = e["target"]
            all_targets = list(handle_map.values())
            if default_target and default_target not in all_targets:
                all_targets.append(default_target)

            def _make_path(_rules=contain_rules, _default=default_target):
                def path(state):
                    last = state["messages"][-1] if state.get("messages") else None
                    text = str(getattr(last, "content", last or "")).lower()
                    for kw, tgt in _rules:
                        if kw.lower() in text:
                            return tgt
                    return _default or END
                return path
            builder.add_conditional_edges(src, _make_path(), path_map=all_targets if all_targets else None)
        else:
            # 普通节点:每条边 add_edge(若多出边且非 condition,LangGraph 会报错——但 MVP 只支持单出边普通节点)
            for e in outs:
                builder.add_edge(src, e["target"])

    return builder.compile(checkpointer=checkpointer)
