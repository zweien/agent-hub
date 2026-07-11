#!/usr/bin/env bash
# CAD 镜像 smoke test:验证 text-to-CAD agent 依赖的完整链路。
#
# 覆盖本次开发踩过的所有坑(python 版本、build123d、转换链、预览链),
# 防止镜像/SKILL 改动后回归。任一环节失败 exit 1。
#
# 用法:
#   bash scripts/smoke-test-cad.sh          # 测试 agent-hub-cad:latest
#   IMAGE=foo:tag bash scripts/smoke-test-cad.sh
#
# 配合构建后自动跑(防回归):
#   bash scripts/build-cad.sh && bash scripts/smoke-test-cad.sh
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE="${IMAGE:-agent-hub-cad:latest}"
TEST_PY="$(pwd)/backend/cad_smoke_test.py"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "❌ 镜像 $IMAGE 不存在,先构建:bash scripts/build-cad.sh"
    exit 1
fi

echo "=== CAD smoke test(镜像 $IMAGE)==="
echo ""

# 挂载测试脚本进容器,用容器内 python3(应为 3.12)运行。
# --rm 跑完即清,不污染镜像层。
docker run --rm \
    -v "$TEST_PY:/app/cad_smoke_test.py:ro" \
    --entrypoint python3 \
    "$IMAGE" /app/cad_smoke_test.py
