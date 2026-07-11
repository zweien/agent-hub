#!/usr/bin/env bash
# 构建 CAD 专用 sandbox 镜像(agent-hub-cad:latest)。
# 预装 build123d/OCP/cadpy/playwright,供 text-to-CAD agent 使用。
#
# 用法: bash scripts/build-cad.sh
# 构建后,SandboxTemplate 里 base_image 填 agent-hub-cad:latest 即可。
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== 构建 agent-hub-cad:latest ==="
echo "这可能需要 5-10 分钟(下载 OCP ~500MB + chromium ~150MB)..."
docker build -f backend/cad.Dockerfile -t agent-hub-cad:latest .

echo ""
echo "=== 构建完成,跑 smoke test(验证完整链路)==="
bash "$(dirname "$0")/smoke-test-cad.sh"
