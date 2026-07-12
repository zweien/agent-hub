# Canvas Orchestration:画布图定义运行时编译为 LangGraph StateGraph 执行

## Status
accepted

## Context
V2 新增 Canvas Orchestration(A 类在 ReactFlow 画布拖拽节点连线成图)。需要决定这个图怎么执行。V1 flat agent 已用 `create_deep_agent`(构建于 LangGraph),`astream_agent` 用 `agent.astream(stream_mode=["messages","updates","values"])` + MemorySaver checkpointer + 事件流投影。

两种执行模型:
- 编译为 LangGraph StateGraph:画布 JSON(节点+边)运行时转换为 `StateGraph`(节点→LangGraph node callable,边→conditional edge)
- 自定义图解释器:平台自写遍历器,逐节点 dispatch,自管状态传递

## Decision
**编译为 LangGraph StateGraph。** 画布 JSON 经运行时 builder 转成 `StateGraph`,V1 现有的 `astream_agent` 流式机制、MemorySaver checkpointer、事件流投影、运行时防护栏全部复用,无需为 canvas 另起一套执行/持久化/流式基础设施。

## Considered Options
- **自定义图解释器**:被否。要重实现 token 流式、checkpointer(会话状态持久/断线重连)、事件流映射、防护栏钩子——与 V1 大量重复,且与 deepagents/LangGraph 生态割裂。

## Consequences
- **节点能力受限于 LangGraph 原语**:每个画布节点必须是 LangGraph node callable 能表达的东西(LLM 调用 / 工具调用 / 子代理委派 / 条件分支 / 聚合)。不支持任意 Python 逻辑节点(安全也更好)。
- **图定义 schema 即编译契约**:canvas JSON 的节点/边 schema 是与 LangGraph 的编译契约,改动需同步 builder。schema 设计是 V2 核心工作。
- **flat/canvas 共享执行底座**:`astream_agent` 不分 flat/canvas,都产出同一套事件流——前端、回放、防护栏无感。
- **编译失败处理**:图定义非法(环无出口/节点引用不存在的工具)时,编译阶段报错,会话不启动(给 A 类明确反馈)。
