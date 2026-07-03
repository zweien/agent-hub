# 自定义 sandbox 镜像:基于 agent-infra/sandbox 预装气动/科学计算依赖。
# 避免 per-session 容器每次运行时 pip install aerosandbox(编译耗时 5min+、易 OOM)。
# 构建: docker build -f backend/sandbox.Dockerfile -t agent-hub-sandbox:latest .
FROM ghcr.io/agent-infra/sandbox:latest

# 预装气动替身 + 科学计算依赖(§4.1:AeroSandbox VLM)
RUN pip install --no-cache-dir aerosandbox numpy
