# Agent Hub

面向无人系统设计优化研究团队的 Agent 开发平台。可视化配置 agent(模型/工具/技能/沙箱),流式对话 + 沙箱代码执行 + 产物预览。

## Language

### Model Catalog
平台侧维护的模型元数据目录(label / max_tokens / context_window / supports_reasoning),存 `models` 表(DB 唯一源)。`resolve_model(id)` 读它,未命中回落全局 env。
_Avoid_: 模型列表、模型配置(后者指 AgentConfig.model 字段)

### Gateway
`192.168.2.220:3000` 的 OpenAI 兼容分发层(疑似 one-api/new-api 类)。所有 chat model 经它路由。平台业务层只认 OpenAI 协议,provider 解耦。
_Avoid_: LiteLLM(报告用名,V1 实际用的是内网分发器)、网关(口语,文档用 Gateway)

### Embedding Source
文档向量化用的 embedding 模型来源。**Gateway 当前不提供 embedding**(实测 /embeddings 对所有常见模型返回 model_not_found)。V2 知识库的 embedding 由运维在 Gateway 后端配 channel 提供(ADR-0001),平台侧继续走 OpenAI 兼容 /embeddings。
_Avoid_: 向量源、embedding 服务

### Sandbox
agent-infra/sandbox(AIO Sandbox)的会话级隔离容器,跑 agent 现写的代码。平台自建 `sandbox_mgr` 控制面管理其生命周期。
_Avoid_: 沙箱(口语,文档用 Sandbox)

### Event Stream
会话的 append-only 事件流(`events` 表,JSONB payload),唯一事实来源。消息/工具/接管/熔断全投影自它。支撑可回放、防护追溯、接管记录。
_Avoid_: 事件日志、消息流(后者是前者的投影)

### Agent Config
A 类用户配置的一个 agent 定义(system_prompt / tools / skills / model / sandbox_template / guard_mode / type),存 `agent_configs` 表。发布后 B 类可选用。
_Avoid_: agent 定义、agent 模板

### Agent Type
Agent Config 的形态分类。`flat`(V1,默认)= 单 LLM+工具循环(create_deep_agent);`canvas`(V2 新增)= A 类在画布上拖拽节点编排的有向图,运行时编译为 LangGraph StateGraph 执行。两者并存,现有气动/CAD agent 保持 flat。
_Avoid_: agent 模式(指 guard_mode)、agent 形态

### Canvas Orchestration
A 类用户在 ReactFlow 画布上拖拽节点(LLM 调用 / 工具 / 子代理 / 条件)连线成图,持久化为 JSON 图定义,运行时编译为 LangGraph StateGraph 执行。是 Agent Type=canvas 的配置与执行方式。
_Avoid_: 工作流(workflow,报告用词,指预定义确定流程)、画布编排(口语)

### Subagent Delegation
flat agent 调 `task` 工具 spawn 一个后台子代理(deepagents SubAgentMiddleware),非阻塞并行执行特定子任务(如"查历史案例"→检索子代理)。前端 SubagentCard 已就绪。是 canvas 的子集能力,flat agent 也可用。
_Avoid_: 子代理委派(口语)、多 agent(泛指)
