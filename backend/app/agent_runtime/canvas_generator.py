"""自然语言 → 画布图定义生成器。

一次 LLM 调用(structured output / JSON mode)把自然语言流程描述转为 canvas_def。
注入该 agent 现有的 tools + subagent_types 作上下文(避免 LLM 虚构不存在的工具)。
生成后经 compile_canvas 校验,失败抛 CanvasCompileError(前端可定位节点重试)。
"""
from __future__ import annotations

import json
import logging

from langchain_openai import ChatOpenAI

from app.config import get_settings, resolve_model

logger = logging.getLogger("canvas_generator")


async def generate_canvas(
    description: str,
    model: str = "",
    enabled_tools: set | None = None,
    subagent_types: list | None = None,
) -> dict:
    """自然语言描述 → canvas_def。返回 {entry_node_id, nodes, edges}。

    description: 用户对流程的自然语言描述(如"检索知识库→分析→人工确认→总结")
    model/enabled_tools/subagent_types: 该 agent 的配置,注入 prompt 作上下文。
    """
    s = get_settings()
    if not s.llm_api_key:
        raise ValueError("LLM_API_KEY 未设置")
    use_model = model or s.llm_model
    mi = resolve_model(use_model)
    llm = ChatOpenAI(
        base_url=s.llm_base_url, api_key=s.llm_api_key, model=use_model,
        max_tokens=mi["max_tokens"], temperature=0.3,
        # JSON 模式:网关实测支持 response_format json_object(DeepSeek)
        model_kwargs={"response_format": {"type": "json_object"}},
    )

    tools_list = sorted(enabled_tools) if enabled_tools else []
    sa_list = [st.get("name") for st in (subagent_types or []) if st.get("name")]

    system_prompt = (
        "你是流程编排助手。把用户对工作流的自然语言描述转成一个画布图定义(JSON)。\n\n"
        "节点类型(8 种):\n"
        "- entry: 图开始(唯一,接 START)\n"
        "- exit: 图结束(接 END)\n"
        "- llm: 调 LLM 生成回复。data: {prompt, model}\n"
        "- tool: 调工具。data: {tool_name}\n"
        "- subagent: 委派子代理。data: {subagent_type}\n"
        "- condition: 条件分支。data: {rules:[{handle, contains, target}]}\n"
        "- hitl: 人工输入暂停。data: {prompt}\n"
        "- loop: 循环。data: {loop_target(回到的节点id), exit_keyword}\n"
        "- parallel: 并行。data: {branches:[节点id], join_target}\n\n"
        "输出 JSON 结构:\n"
        '{"entry_node_id":"n1","nodes":[{"id":"n1","type":"entry","data":{}},'
        '{"id":"n2","type":"llm","data":{"prompt":"...","model":""}}],'
        '"edges":[{"source":"n1","target":"n2"}]}\n\n'
        f"可用工具(仅可用这些,tool 节点的 tool_name 必须在此): {tools_list or '无'}\n"
        f"可用子代理类型(subagent 节点的 subagent_type 必须在此): {sa_list or '无'}\n\n"
        "规则:\n"
        "1. 必须有且仅有 1 个 entry 节点(作为 entry_node_id),至少 1 个 exit\n"
        "2. 节点 id 用 n1,n2,...(entry 必须是 entry_node_id)\n"
        "3. edges 的 source/target 必须是已定义的节点 id\n"
        "4. condition 节点的 rules[].target 必须是节点 id;handle 是分支标签(如 yes/no)\n"
        "5. loop 的 loop_target 必须是已定义的节点 id(通常是前面的节点)\n"
        "6. parallel 的 branches 是要并行的节点 id 列表\n"
        "7. 无可用工具时不要用 tool 节点;无子代理时不要用 subagent 节点\n"
        "8. 保持图简单可执行:entry → ... → exit 链路连通"
    )

    messages = [
        ("system", system_prompt),
        ("user", f"流程描述:{description}\n\n请生成画布图 JSON。"),
    ]

    resp = await llm.ainvoke(messages)
    raw = resp.content if isinstance(resp.content, str) else str(resp.content)
    # 健壮解析:LLM(尤其推理模型)偶尔把 JSON 包在 ```json ``` 或文本里。
    # 先试直接解析;失败则抽取首个 {...} 块再解析。
    canvas_def = None
    try:
        canvas_def = json.loads(raw)
    except json.JSONDecodeError:
        # 抽取首个 { 到末尾 } 的子串(贪婪到最外层)
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            try:
                canvas_def = json.loads(raw[start:end + 1])
            except json.JSONDecodeError as e:
                raise ValueError(f"LLM 返回非合法 JSON(抽取后仍失败): {e};原文: {raw[:200]}") from e
        else:
            raise ValueError(f"LLM 返回非合法 JSON(无 {...} 块): {raw[:200]}")
    if canvas_def is None:
        raise ValueError(f"LLM 返回非合法 JSON: {raw[:200]}")

    # 基本结构校验(编译校验留给 compile_canvas)
    if not isinstance(canvas_def, dict):
        raise ValueError("生成的 canvas_def 非对象")
    for k in ("entry_node_id", "nodes", "edges"):
        if k not in canvas_def:
            raise ValueError(f"生成的 canvas_def 缺字段: {k}")
    logger.info("生成画布:%d 节点 %d 边, entry=%s",
                len(canvas_def.get("nodes", [])), len(canvas_def.get("edges", [])),
                canvas_def.get("entry_node_id"))
    return canvas_def
