# Agent Hub V1 后端镜像
# Python 3.11(与 POC 一致;aerosandbox 已验证可装)
FROM python:3.11-slim

# 系统依赖(aerosandbox/scipy 编译运行所需)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential gcc g++ libglib2.0-0 libsm6 libxext6 libxrender1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先装依赖(利用 Docker 层缓存;用国内镜像源加速)
COPY requirements.txt .
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt

# 复制应用代码
COPY app/ ./app/

# 环境默认值(可被 compose 的 environment 覆盖)
ENV PYTHONUNBUFFERED=1

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
