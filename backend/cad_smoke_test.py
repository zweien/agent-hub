"""CAD 镜像 smoke test:覆盖 text-to-CAD agent 依赖的完整链路。

在 CAD 镜像内执行(由 scripts/smoke-test-cad.sh 调用),验证:
  1. python3 默认指向 3.12(build123d 所在),非系统 3.10
  2. build123d 能建模 + 导出 STEP(agent 主输出)
  3. STEP→STL→trimesh→GLB 转换链(前端 3D 预览用)
  4. STEP→STL→matplotlib PNG 渲染(cad-viewer skill 的预览方式)

任一环节失败即 exit 1(供 CI/构建脚本捕获)。
失败信息会明确指出是哪个环节,方便定位回归。

用法(容器内):
  python3 /app/cad_smoke_test.py   # 镜像里 COPY 到 /app
或(宿主机):
  bash scripts/smoke-test-cad.sh
"""
from __future__ import annotations

import os
import sys
import tempfile

# 所有断言失败的统一出口:打印清晰环节名 + 原因,exit 1
FAILURES: list[str] = []


def check(name: str, fn):
    """跑一个检查;异常或返回 False 记为失败。"""
    try:
        result = fn()
        if result is False:
            FAILURES.append(name)
            print(f"  ✗ {name}")
        else:
            print(f"  ✓ {name}")
    except Exception as e:
        FAILURES.append(f"{name}: {type(e).__name__}: {e}")
        print(f"  ✗ {name}: {type(e).__name__}: {e}")


def test_python_version():
    """python3 必须是 3.12(build123d/cadpy 所在),不能是系统 3.10。"""
    assert sys.version_info[:2] == (3, 12), \
        f"python3 是 {sys.version_info[0]}.{sys.version_info[1]},应为 3.12" \
        "(build123d 装在 3.12;3.10 会 ModuleNotFoundError)"


def test_build123d_modeling():
    """build123d 建模 + STEP 导出(agent 核心能力)。"""
    from build123d import Box, Cylinder
    from build123d.exporters3d import export_step

    part = Box(50, 50, 20) - Cylinder(5, 30)  # 带孔盒子(布尔运算)
    assert part.volume > 0, f"体积应为正,实际 {part.volume}"
    assert part.is_valid, "几何无效(is_valid 是 bool 属性,不是方法)"

    step = tempfile.NamedTemporaryFile(suffix=".step", delete=False).name
    export_step(part, step)
    assert os.path.getsize(step) > 0, "STEP 文件为空"
    return step  # 给后续测试复用


def test_step_to_glb(step_path):
    """STEP→STL→GLB 转换链(前端 3D 预览,model-viewer 渲染 GLB)。"""
    import trimesh
    from build123d import import_step
    from build123d.exporters3d import export_stl

    stl = tempfile.NamedTemporaryFile(suffix=".stl", delete=False).name
    glb = tempfile.NamedTemporaryFile(suffix=".glb", delete=False).name
    export_stl(import_step(step_path), stl)
    trimesh.load(stl).export(glb)
    assert os.path.getsize(glb) > 100, f"GLB 过小({os.path.getsize(glb)}B),可能空网格"
    scene = trimesh.load(glb)
    geoms = list(scene.geometry.values()) if hasattr(scene, "geometry") else [scene]
    total_verts = sum(len(g.vertices) for g in geoms)
    assert total_verts > 0, "GLB 网格无顶点"


def test_step_to_png(step_path):
    """STEP→STL→matplotlib PNG(cad-viewer skill 的预览方式,纯 headless)。"""
    import matplotlib
    matplotlib.use("Agg")  # 必须在 pyplot 前,headless
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    import trimesh
    from build123d import import_step
    from build123d.exporters3d import export_stl

    stl = tempfile.NamedTemporaryFile(suffix=".stl", delete=False).name
    export_stl(import_step(step_path), stl)
    mesh = trimesh.load(stl)
    v, f = mesh.vertices, mesh.faces

    png = tempfile.NamedTemporaryFile(suffix=".png", delete=False).name
    fig = plt.figure(figsize=(8, 6))
    ax = fig.add_subplot(111, projection="3d")
    ax.add_collection3d(Poly3DCollection(v[f], alpha=0.85))
    ax.set_xlim(v[:, 0].min(), v[:, 0].max())
    ax.set_ylim(v[:, 1].min(), v[:, 1].max())
    ax.set_zlim(v[:, 2].min(), v[:, 2].max())
    plt.savefig(png, dpi=80)
    plt.close(fig)
    assert os.path.getsize(png) > 1000, f"PNG 过小({os.path.getsize(png)}B),渲染可能失败"


def main():
    print("=== CAD 镜像 smoke test ===\n")

    check("python3 版本 = 3.12", test_python_version)
    step = None

    def _model():
        nonlocal step
        step = test_build123d_modeling()
    check("build123d 建模 + STEP 导出", _model)

    if step:
        check("STEP→STL→GLB(3D 预览链)", lambda: test_step_to_glb(step))
        check("STEP→STL→PNG(2D 预览链)", lambda: test_step_to_png(step))
    else:
        print("  ⊘ 建模失败,跳过后续转换链测试")
        FAILURES.append("依赖:建模失败导致转换链未测")

    print("")
    if FAILURES:
        print(f"❌ {len(FAILURES)} 项失败:")
        for f in FAILURES:
            print(f"   - {f}")
        sys.exit(1)
    print("✅ CAD 镜像链路全部通过")
    sys.exit(0)


if __name__ == "__main__":
    main()
