#!/usr/bin/env python3
"""Seed text-to-CAD agent:CAD 建模能力集成。

前置:需先构建 CAD 镜像 → bash scripts/build-cad.sh
用法:
  cd backend
  python poc/seed_cad.py

创建:
  - 2 个 Skill:cad(核心建模)、cad-viewer(几何预览)
  - 1 个 SandboxTemplate:CAD 沙箱(agent-hub-cad 镜像,宽松硬件限制)
  - 1 个 AgentConfig:CAD 设计助手(关联上述 skill + template)

幂等:按 name upsert,可重复运行(更新内容,不重复创建)。
"""
from __future__ import annotations

import os
import sys

# 把 backend 根目录加入 sys.path,使 from app.xxx import 能工作
_BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

from app.db import SessionLocal         # noqa: E402
from app.models.skill import Skill      # noqa: E402
from app.models.sandbox_template import SandboxTemplate  # noqa: E402
from app.models.agent_config import AgentConfig          # noqa: E402
from app.sandbox_mgr import skill_store                  # noqa: E402


# ============ Skill 内容 ============

CAD_SKILL_CONTENT = """\
# CAD 参数化建模(build123d)

从自然语言或图片需求,用 build123d 生成参数化 CAD 模型,主输出 STEP。

## ⛔ 硬约束(必须遵守,否则陷入死循环)

- **只用 build123d,严禁使用 cadquery / pythonocc-core / OCP / gmsh / ezdxf**。
  这些库未预装,`pip install` 会失败或拖垮;cadquery 装在系统 python3.10 会冲突。
  build123d 已预装在 python3(3.12),直接 `python3 your_script.py` 即可。
- **不要 `pip install` 任何 CAD 库**。build123d + trimesh + matplotlib 已就绪。
- **不要 import ocp_vscode**(无此模块,是 VSCode 扩展专用)。
- **脚本失败时最多改 2 次**;连续失败说明方向错了,停下来报告错误,
  不要反复 pip install / 换库 / 改 API 重试。

## 最小可运行模板(直接照抄改参数)

```python
# /workspace/part.py — 写好后 python3 /workspace/part.py 运行
from build123d import Box, Cylinder, Mode
from build123d.exporters3d import export_step

# 建模(示例:带孔的盒子)
part = Box(50, 50, 20) - Cylinder(5, 30)

# 导出 STEP
export_step(part, "/workspace/artifacts/part.step")

# 自检
assert part.volume > 0
assert part.is_valid  # is_valid 是 bool 属性,不是方法
print(f"体积 = {part.volume:.1f} mm³,STEP 已导出")
```

## 工作流

1. **理解需求**:确认零件几何、尺寸、单位(默认 mm)、约束
2. **写 build123d 代码**(照抄上方模板改参数,不要换库)
3. **导出 STEP**:`export_step(part, "/workspace/artifacts/<name>.step")`
4. **自检**:`part.volume > 0` 且 `part.is_valid`(bool 属性)
5. **生成预览**:参考 cad-viewer skill(照抄其验证过的代码,不要自己发挥 API)
6. **失败处理**:脚本报错就读 traceback 修;连续 2 次失败就停下报告

## build123d 速查

```python
from build123d import Box, Cylinder, Mode, Axis, Plane

# 基本体
box = Box(100, 60, 30)        # 长宽高(mm)
cyl = Cylinder(10, 50)        # 半径、高度
# 布尔运算
part = box - cyl               # 减(打孔)
part = box + cyl               # 加(凸台)
part = box & cyl               # 交
# 导出 STEP
from build123d.exporters3d import export_step
export_step(part, "/workspace/artifacts/part.step")
# 自检
print(f"体积 = {part.volume:.1f} mm³")
assert part.volume > 0
assert part.is_valid  # bool 属性,不是方法
```

## 单位与坐标约定

- 单位:**mm**(所有尺寸按毫米)
- 基面:XY 平面,+Z 向上拉伸
- 原点:零件几何中心或基准角,视需求

## 常见 UAV 零件

- 翼型肋板:用样条曲线 + 拉伸
- 电机支架:Box + 圆柱布尔运算(电机孔、安装孔)
- 电池舱:薄壁盒体(offset 面向内)
- 起落架支架:扫掠或放样
"""

CAD_VIEWER_SKILL_CONTENT = """\
# CAD 几何预览(cad-viewer)

将 CAD 几何渲染为 PNG 快照,headless 模式(不依赖 X server,不弹窗)。

## 工作流

1. 先用 cad skill 生成 STEP 文件(或 build123d 对象)
2. 用 playwright headless 渲染几何为 PNG
3. 输出到 `/workspace/artifacts/preview.png`

## 渲染方式(唯一推荐:STEP→STL→matplotlib,已验证可运行)

```python
# 完整可运行脚本:直接照抄,把 STEP 路径改成你的产物文件名即可。
# 转换链 STEP→STL(build123d export_stl)→ trimesh 加载网格 → matplotlib 出 PNG。
# 纯 headless(不依赖 pyglet/X server/OpenGL),CAD 镜像已预装 build123d+trimesh+matplotlib。
import matplotlib
matplotlib.use("Agg")  # 必须在最前,headless
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
from build123d import import_step
from build123d.exporters3d import export_stl
import trimesh, tempfile, os

STEP = "/workspace/artifacts/part.step"      # ← 改成你的 STEP 路径
OUT = "/workspace/artifacts/preview.png"

# STEP → STL → 网格
part = import_step(STEP)
stl = tempfile.NamedTemporaryFile(suffix=".stl", delete=False).name
export_stl(part, stl)
mesh = trimesh.load(stl)
os.unlink(stl)

# matplotlib 3D 渲染网格面
v, f = mesh.vertices, mesh.faces
fig = plt.figure(figsize=(8, 6))
ax = fig.add_subplot(111, projection="3d")
ax.add_collection3d(Poly3DCollection(v[f], alpha=0.85,
    facecolor="#9ecae1", edgecolor="#3182bd", linewidth=0.3))
ax.set_xlim(v[:, 0].min(), v[:, 0].max())
ax.set_ylim(v[:, 1].min(), v[:, 1].max())
ax.set_zlim(v[:, 2].min(), v[:, 2].max())
ax.set_box_aspect([1, 1, 1])
ax.view_init(elev=25, azim=-50)
ax.set_xlabel("X (mm)"); ax.set_ylabel("Y (mm)"); ax.set_zlabel("Z (mm)")
plt.tight_layout()
plt.savefig(OUT, dpi=100)
print(f"预览图已生成: {OUT} ({os.path.getsize(OUT)} bytes)")
```

> ⚠️ 不要用以下过时/不可用的 API(会导致反复失败):
> - `build123d.exporters2d.matplotlib_svg`(0.11+ 已移除)
> - `face.triangulate()`(Face 对象无此方法)
> - `/opt/text-to-cad/skills/cad-viewer/scripts/snapshot`(是目录非可执行文件,跑不通)
> - `trimesh.Scene.save_image`(需 pyglet,headless 无)

## 输出约定

- 文件名固定为 `preview.png`(后端 artifacts 路由按名预览)
- 尺寸 800×600,白底

## 注意

- `matplotlib.use("Agg")` 必须在 import pyplot 之前,否则找 X server 报错
- 把脚本写到 `/workspace/preview.py` 后 `python3 /workspace/preview.py` 运行
"""


# ============ Agent system_prompt ============

CAD_AGENT_PROMPT = """\
你是 UAV CAD 设计 agent,用 build123d 参数化建模,从自然语言描述生成可制造的 CAD 零件。

## 硬约束(始终遵守)

- 单位:mm(毫米)
- 基面:XY 平面,Z 向上拉伸
- 主输出:STEP 文件,写到 /workspace/artifacts/<name>.step
- 附加输出:按需导出 STL/GLB 到 /workspace/artifacts/
- 完成建模后:用 cad-viewer skill 生成 PNG 快照到 /workspace/artifacts/preview.png
- 在回复里用 markdown 引用预览图(路径固定写法,{SESSION_ID} 占位符由系统自动替换为当前会话 ID):
  ![预览](/api/sessions/{SESSION_ID}/artifacts/artifacts/preview.png)
  (文件在 /workspace/artifacts/preview.png,API 路径含两层 artifacts)
- 自检:验证体积为正(`part.volume > 0`)、几何有效(`part.is_valid`,bool 属性),不过关就修

## 工作流

1. 确认零件类型、关键尺寸、约束(不明确就问用户)
2. 参考 cad skill 写 build123d Python 代码
3. 在沙箱里执行,导出 STEP
4. 自检几何
5. 生成 PNG 预览
6. 回复用户:简述设计 + 引用预览图 + 说明可在右侧"产物"面板下载 STEP

工作流细节(build123d API、脚本调用、单位约定)参考 cad skill。
"""


# ============ upsert 辅助 ============

def upsert_skill(db, name, description, content):
    s = db.query(Skill).filter(Skill.name == name).first()
    if s:
        s.description = description
        s.content = content
        s.is_published = True
        db.commit()
        db.refresh(s)
        verb = "更新"
    else:
        s = Skill(name=name, description=description, content=content,
                  scripts=[], owner_id="admin", is_published=True)
        db.add(s)
        db.commit()
        db.refresh(s)
        verb = "创建"
    # 同步到文件系统(session_runner 从这里读)
    skill_store.save_skill_files(s.id, s.content, {}, name=s.name, description=s.description)
    print(f"  [{verb}] Skill {name} → {s.id}")
    return s


def upsert_template(db, name, **fields):
    t = db.query(SandboxTemplate).filter(SandboxTemplate.name == name).first()
    if t:
        for k, v in fields.items():
            setattr(t, k, v)
        db.commit()
        db.refresh(t)
        verb = "更新"
    else:
        t = SandboxTemplate(name=name, owner_id="admin", is_published=True, **fields)
        db.add(t)
        db.commit()
        db.refresh(t)
        verb = "创建"
    print(f"  [{verb}] Template {name} → {t.id}")
    return t


def upsert_agent(db, name, **fields):
    a = db.query(AgentConfig).filter(AgentConfig.name == name).first()
    if a:
        for k, v in fields.items():
            setattr(a, k, v)
        a.is_published = True
        db.commit()
        db.refresh(a)
        verb = "更新"
    else:
        a = AgentConfig(name=name, owner_id="admin", is_published=True, **fields)
        db.add(a)
        db.commit()
        db.refresh(a)
        verb = "创建"
    print(f"  [{verb}] Agent {name} → {a.id}")
    return a


# ============ 主流程 ============

def main():
    db = SessionLocal()
    try:
        print("=== Seed text-to-CAD agent ===\n")

        # 检查 CAD 镜像是否已构建(温馨提示)
        import docker
        client = docker.from_env()
        try:
            client.images.get("agent-hub-cad:latest")
        except Exception:
            print("⚠️  警告:agent-hub-cad:latest 镜像未找到!")
            print("   请先构建:bash scripts/build-cad.sh")
            print("   (继续 seed,但启动 CAD 会话会失败直到镜像就绪)\n")

        print("=== 创建 Skill ===")
        cad_skill = upsert_skill(db, "cad",
                                 "用 build123d 从自然语言生成参数化 CAD 模型,输出 STEP/STL/3MF/GLB。涉及 UAV 零件建模、翼型肋板、支架设计时使用。",
                                 CAD_SKILL_CONTENT)
        viewer_skill = upsert_skill(db, "cad-viewer",
                                    "渲染 CAD 几何为 PNG 快照(headless 模式)。建模完成后生成预览图。",
                                    CAD_VIEWER_SKILL_CONTENT)

        print("\n=== 创建 SandboxTemplate ===")
        tpl = upsert_template(db, "CAD 沙箱 (build123d/OCP)",
                              base_image="agent-hub-cad:latest",
                              pip_packages=[],      # 全在镜像里
                              env_vars={},
                              cpu_limit=4.0,        # 宽松限制(乙方案)
                              mem_limit="8g",
                              gpu_count=0,          # CAD 纯 CPU
                              shm_size="2g")

        print("\n=== 创建 AgentConfig ===")
        upsert_agent(db, "CAD 设计助手 (text-to-CAD)",
                     system_prompt=CAD_AGENT_PROMPT,
                     tools=[],                               # deepagents exec + skill 脚本够用
                     skill_ids=[cad_skill.id, viewer_skill.id],
                     sandbox_template_id=tpl.id,
                     model="deepseek-v4-flash",              # 默认,可在配置里切强模型
                     mode="standard")

        print("\n=== 完成 ===")
        print("✓ text-to-CAD agent 已就绪")
        print("  前端 → Agent 配置页可看到 'CAD 设计助手 (text-to-CAD)'")
        print("  开会话选择该配置,输入如 '画个 100mm 立方体导出 STEP' 即可")
    finally:
        db.close()


if __name__ == "__main__":
    main()
