# Embedding 源:由运维在 Gateway 后端配 channel,平台侧走 OpenAI 兼容 /embeddings

## Status
accepted

## Context
V1 知识库(§5.3)因"内网 embedding 源待定"主动暂停。实测 Gateway(`192.168.2.220:3000`,one-api/new-api 类分发器)的 `/embeddings` 对 bge-m3 / bge-large-zh / text-embedding-3-small / Qwen3-Embedding / embedding-2 全部返回 `model_not_found` —— Gateway 目前只配了 3 个 chat model channel,没有 embedding channel。

V2 要建知识库(向量 RAG),必须有 embedding 源。

## Decision
不在平台侧自建 embedding 服务(不引入 sentence-transformers 本地推理,也不起独立 vLLM/TEI 服务)。**embedding 由运维在 Gateway 后端配一个 embedding channel(如 bge-m3)**,平台侧继续走 OpenAI 兼容 `/embeddings`,与现有 chat model 同一套 Gateway 抽象,provider 解耦。

## Considered Options
- **本地 sentence-transformers(backend 容器内)**:零额外服务、最自控,但首次下载权重 + CPU 推理慢 + 镜像变大。被否:与 V1"业务层只认 OpenAI 协议"的设计一致原则冲突,且 CPU 推理是长期负担。
- **独立 embedding 服务(vLLM/TEI,带 GPU)**:性能最好,但多一个组件运维,V2 初期量级不到。

## Consequences
- **外部依赖**:V2 知识库 feature 阻塞在运维配 channel 上。channel 配好前,知识库不可发布(embedding 调用会 404)。
- **可切换**:换 embedding 模型只改 Gateway channel 配置,平台代码不动(沿用 chat model 同模式)。但**换模型 = 历史 embedding 失效,需重新索引全部文档**(embedding 维度/空间不兼容)。
- **embedding 模型名**:需与运维约定一个固定 model id(如 `bge-m3`),平台侧 hardcode 或配进 `models` 表(V2 决策)。
