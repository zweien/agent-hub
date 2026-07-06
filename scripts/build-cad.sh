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
echo "=== 构建完成,验证 ==="
docker run --rm --entrypoint /opt/python3.12/bin/python3.12 agent-hub-cad:latest -c "
import build123d
print(f'build123d {build123d.__version__}')
from build123d.objects_part import Box
b = Box(10, 10, 10)
print(f'OCP works: Box volume = {b.volume} mm3')
import cadpy
print(f'cadpy OK')
print('CAD 镜像就绪')
"
