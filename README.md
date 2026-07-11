# Agent Hub

BS 架构的 Agent 开发平台 —— 面向无人系统设计优化研究团队。可视化编排 agent(prompt / 工具 / 技能 / 模型 / 沙箱),流式对话 + 沙箱代码执行 + 产物预览。

> 设计文档:`docs/V1构建指令.md`、`docs/可行性与技术选型报告.md`。

## 技术栈

**后端** — FastAPI + LangGraph(deepagents)+ PostgreSQL(pgvector)+ Redis。模块化单体,agent 内核(`agent_runtime/`)是最硬的边界。

**前端** — Next.js 16 + React 19 + Tailwind v4 + shadcn/ui + ai-elements。流式 WS 对话 + 3D 产物预览(model-viewer)。

**沙箱** — 会话级隔离容器(AIO Sandbox),agent 可在其中执行 Python/build123d 代码。CAD 能力经独立镜像(`agent-hub-cad`)提供。

```
agent-hub/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 入口 + router 注册
│   │   ├── config.py            # 配置(读 .env)+ resolve_model(读 DB)
│   │   ├── api/                 # 路由层(agents/tools/skills/models/sessions/...)
│   │   ├── agent_runtime/       # ★ agent 内核(create_deep_agent + 流式 + 熔断)
│   │   ├── tools/               # 内置工具(run_aero 等,@tool 包装)
│   │   ├── sandbox_mgr/         # 沙箱控制面(会话级容器生命周期)
│   │   ├── models/              # ORM(agent_config/tool/skill/model/sandbox_template/...)
│   │   └── auth.py              # 鉴权(token + 三角色 admin/builder/user)
│   ├── poc/                     # POC 验证产物(存档)
│   ├── skills/                  # agent skills(SKILL.md,挂载进沙箱)
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── cad.Dockerfile           # CAD 沙箱镜像(build123d/trimesh/ocp)
│   └── .env                     # 密钥(不进 git)
├── frontend/
│   ├── app/                     # 页面(chat/agents/tools/skills/models/sessions/...)
│   ├── components/              # chat-view / sidebar / artifacts-panel / resize-handle
│   ├── hooks/                   # use-chat-socket(WS 流式协议)
│   └── contexts/                # auth / ui(面板宽度记忆)
├── scripts/                     # build-cad.sh / smoke-test-cad.sh
├── docker-compose.yml           # 全栈:db + redis + backend
└── docs/
```

## 启动方式

### 方式一:Docker Compose 全栈(推荐)

```bash
# 1. 配置 LLM(复制模板填密钥)
cp backend/.env.example backend/.env  # 或直接创建,见下方配置表

# 2. 起全栈(db + redis + backend)
docker compose up -d --build

# 3.(可选)CAD 能力需另构建 CAD 沙箱镜像
scripts/build-cad.sh
```

服务:
- **backend**:http://localhost:8000(交互文档:/docs,WebSocket:/ws/chat)
- **frontend**:http://localhost:3000(`cd frontend && npm run dev`,或 `npm run build && npm start`)
- **db**:postgres+pgvector(localhost:5432)
- **redis**:localhost:6379

### 方式二:本地直跑(开发)

```bash
# 后端
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 前端(另一终端)
cd frontend
npm install
npm run dev
```

> 本地直跑时沙箱代码执行工具不可用(需沙箱容器服务);单次气动分析 `run_aero_tool` 在后端进程内直接算,可用。

## 验证

```bash
# 健康(脱敏配置摘要)
curl http://localhost:8000/health

# 登录(三角色:admin/admin123、builder/builder123、user/user123)
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# 模型目录(DB 唯一源)
TOKEN=<上面返回的 token>
curl http://localhost:8000/models -H "Authorization: Bearer $TOKEN"
```

流式对话走 WebSocket(`ws://localhost:8000/ws/chat?token=...`),事件类型:token / reasoning / todos / tool_start / tool_end / sandbox_exec / done(含每轮用量+耗时)/ error。前端 `/chat` 页开箱即用。

## 配置

`backend/.env`(密钥,不进 git):

| 变量 | 说明 |
|------|------|
| `LLM_BASE_URL` | OpenAI 兼容 endpoint(网关) |
| `LLM_API_KEY` | 模型密钥 |
| `LLM_MODEL` | 默认模型名(如 deepseek-v4-flash) |
| `LLM_MAX_TOKENS` | 推理模型需 ≥16000(reasoning 计入 max_tokens) |
| `LLM_CONTEXT_WINDOW` | 模型上下文窗口(deepagents 摘要触发线,默认 65536) |
| `SANDBOX_IMAGE` | 沙箱镜像(默认 agent-hub-sandbox:latest) |
| `SANDBOX_GPU` | 沙箱是否启用 GPU |
| `SANDBOX_BASE_URL` | 沙箱服务地址(Compose 内 http://sandbox:8080) |
| `DATABASE_URL` | postgres+pgvector 连接串 |
| `REDIS_URL` | redis 连接串 |

## 核心功能

- **Agent 配置**:可视化配置 prompt / 工具 / 技能 / 模型 / 沙箱模板 / 防护模式(standard / 严谨 / YOLO),发布后供对话使用。预置气动优化助手 + text-to-CAD 设计助手。
- **流式对话**:WebSocket token 级流式,DeepSeek 推理模型支持(reasoning 流式 + monkeypatch 提取),实时计划进度(todos)+ 思考过程卡片 + 工具调用卡片 + 沙箱执行卡片。
- **沙箱代码执行**:会话级隔离容器,agent 生成代码并在其中执行(Python/build123d),stdout/产物回传。空闲自动回收,支持单人接管(VSCode/VNC)。
- **产物系统**:STEP/STL → GLB(trimesh 链)→ 前端 3D 预览(model-viewer);图片/PDF/文本产物树形浏览 + inline 预览。
- **模型管理**:DB 唯一源的模型目录(label / max_tokens / 上下文窗口 / 是否推理),页面全 CRUD;每轮对话统计 token 用量 + 耗时。
- **运行时防护**:熔断(超轮数 / 超时 / 工具连续失败 6 次)、上下文自动压缩(SummarizationMiddleware)、并发任务拒绝、HITL 工具确认。
- **技能/工具管理**:SKILL.md 技能(deepagents SkillsMiddleware 发现 + 挂载);异构工具(python/bash/web/mcp)统一管理。

## 角色

| 角色 | 能力 |
|------|------|
| admin | 全部权限(含沙箱管理) |
| builder(A 类) | 配置/发布 agent、工具、技能、模型 |
| user(B 类) | 对话 + 只读看配置 |
