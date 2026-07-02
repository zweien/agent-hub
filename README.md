# Agent Hub

BS 架构的 Agent 开发平台(面向无人系统设计优化研究团队)。

> 文档:`docs/V1构建指令.md`(V1 唯一执行权威)、`docs/可行性与技术选型报告.md`(全景调研留档)。

## 当前阶段:V1 主体 · 脚手架

模块化单体(§2.2),FastAPI 后端 + Docker Compose 全栈。

```
agent-hub/
├── backend/
│   ├── app/                  # 模块化单体(§2.2 边界)
│   │   ├── main.py           # FastAPI 入口
│   │   ├── config.py         # 配置(读 .env)
│   │   ├── api/              # 路由层(health/chat)
│   │   ├── agent_runtime/    # ★ 最硬边界:LangGraph agent 内核
│   │   ├── tools/            # 气动工具(run_aero,@tool 包装)
│   │   ├── sandbox_mgr/      # 沙箱控制面(HTTP API 后端)
│   │   ├── knowledge/        # 知识库(本轮占位,后续 pgvector)
│   │   └── models/           # API schema
│   ├── poc/                  # POC 验证产物(存档,不修改)
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env                  # 密钥(不进 git;.env.example 是模板)
├── docker-compose.yml        # 全栈:db(pgvector)+redis+sandbox+backend
└── docs/
```

## 启动方式

### 方式一:本地直跑(最快,无 Compose)

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

> 本地直跑时,sandbox 工具(sandbox 扫描)不可用(需 sandbox 服务);
> 单次气动分析 `run_aero_tool` 在后端进程内直接算,可用。

### 方式二:Docker Compose 全栈(推荐)

```bash
docker compose up --build
```

服务:
- backend: http://localhost:8000 (docs: /docs)
- sandbox: http://localhost:8080 (AIO Sandbox,VSCode/VNC/API)
- db: postgres+pgvector (localhost:5432)
- redis: localhost:6379

## 验证

```bash
# 健康
curl http://localhost:8000/health

# 对话(气动分析)
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"帮我算翼展10米、面积10平米、迎角3度的机翼升阻比"}'
```

## 配置

复制 `backend/.env.example` 为 `backend/.env`,填入 LLM 配置。

| 变量 | 说明 |
|------|------|
| `LLM_BASE_URL` | OpenAI 兼容 endpoint |
| `LLM_API_KEY` | 模型密钥 |
| `LLM_MODEL` | 模型名(如 deepseek-v4-flash) |
| `LLM_MAX_TOKENS` | 推理模型需 ≥3000 |
| `SANDBOX_BASE_URL` | sandbox 服务地址(Compose 内 http://sandbox:8080) |

## 边界(本轮不做,见 V1构建指令 §10)

事件流(§2.5)、WebSocket 流式(§2.3)、运行时防护(§5.4)、单人接管(§2.3)、知识库检索(§5.3)、前端 —— 留后续步骤。
