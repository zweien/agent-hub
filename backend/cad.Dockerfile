# CAD 专用 sandbox 镜像:基于 AIO sandbox 预装 build123d/OCP/cadpy/playwright。
# 用于 text-to-CAD agent——从自然语言生成参数化 CAD(STEP/STL/3MF/GLB)。
# 避免 per-session 容器每次 pip install OCP(OpenCascade ~500MB,编译/下载耗时且易失败)。
#
# 注意:AIO sandbox 有两个 Python——系统 python3(3.10) 和 /opt/python3.12/bin/python3.12(3.12)。
# cadpy 要求 Python >=3.11,且 sandbox 的 python-server/jupyter 等核心服务跑在 3.12 上,
# 因此 CAD 依赖全部装到 python3.12(PY=python3.12),保证一致性。
#
# 构建: bash scripts/build-cad.sh   或   docker build -f backend/cad.Dockerfile -t agent-hub-cad:latest .
FROM ghcr.io/agent-infra/sandbox:latest

# 统一用 python3.12 装依赖(匹配 AIO sandbox 核心服务 + cadpy 的 >=3.11 要求)
ENV PY=/opt/python3.12/bin/python3.12

# 清华 pip 镜像加速(与 backend/Dockerfile、sandbox.Dockerfile 一致)
RUN $PY -m pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple

# build123d:参数化 CAD 内核,其依赖链会自动拉入 OCP(cadquery-ocp-novtk/proxy = OpenCascade bindings)。
RUN $PY -m pip install --no-cache-dir build123d

# trimesh:STEP→GLB 转换链(前端 3D 预览)用。烤进镜像避免首次预览时 pip 下载延迟 / 内网无 PyPI 出口失败。
RUN $PY -m pip install --no-cache-dir trimesh

# playwright:cad-viewer skill 的 snapshot 渲染需要(headless 出 PNG)
RUN $PY -m pip install --no-cache-dir playwright \
    && $PY -m playwright install chromium

# text-to-cad 仓库:SKILL.md 工作流 + cadpy 包。
# 用 codeload tarball 替代 git clone(GitHub 在国内不稳定,HTTPS tarball 更可靠)。
RUN $PY -c "import urllib.request,tarfile,io; \
        url='https://codeload.github.com/earthtojake/text-to-cad/tar.gz/refs/heads/main'; \
        data=urllib.request.urlopen(url,timeout=120).read(); \
        tarfile.open(fileobj=io.BytesIO(data)).extractall('/opt')" \
    && mv /opt/text-to-cad-main /opt/text-to-cad \
    && $PY -m pip install --no-cache-dir /opt/text-to-cad/packages/cadpy

# 产物目录约定:CAD agent 把 STEP/STL/PNG 等输出写到 /workspace/artifacts/
# 后端 GET /sessions/{id}/artifacts 从此目录读取
RUN mkdir -p /workspace/artifacts
WORKDIR /workspace
