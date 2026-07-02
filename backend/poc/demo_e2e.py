"""
气动 POC 端到端演示(§9 完整验收)。

模拟整条链路:
  1. SandboxManager 起容器(§3 控制面)
  2. 容器内装 aerosandbox
  3. 拷入 run_aero 气动替身(§4.1)
  4. 模拟"agent 现写的参数扫描脚本"(决策#4):扫展弦比找最大升阻比
  5. 容器内执行,返回优化结论
  6. 回收容器

这模拟了真实 agent 的工作:不是只调一次 run_aero,而是写一段扫描代码自主寻优。

运行: python demo_e2e.py
"""
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "sandbox"))
from manager import SandboxManager  # noqa: E402

# "agent 现写的参数扫描脚本"——模拟 agent 为找最优展弦比而生成的代码。
# 这正是决策 #4(agent 写代码场景)的体现:agent 动态生成这段,丢进 sandbox 跑。
AGENT_GENERATED_SWEEP = r"""
import sys; sys.path.insert(0, "/workspace")
from llt import run_aero
import numpy as np

# 扫展弦比 AR 6→14,面积固定,找最大升阻比
print("=== agent 现写脚本:展弦比寻优 ===")
hdr = "{:>5} {:>8} {:>8} {:>10}".format("AR", "L_D", "CL", "CD_total")
print(hdr)
best = None
for ar in np.arange(6, 14.1, 1.0):
    span = (ar * 10.0) ** 0.5  # 面积=10 固定
    r = run_aero(span=span, area=10.0, alpha_deg=3.0)
    print("{:>5.1f} {:>8.2f} {:>8.4f} {:>10.5f}".format(ar, r['L_D'], r['CL'], r['CD_total']))
    if best is None or r["L_D"] > best["L_D"]:
        best = dict(r); best["AR"] = ar; best["span"] = span
print()
print("=== 优化结论:最优展弦比 AR={:.1f}, 对应升阻比 L/D={:.2f} ===".format(best['AR'], best['L_D']))
"""


def main():
    logging.basicConfig(level=logging.WARNING)
    mgr = SandboxManager(image="python:3.11-slim")  # POC 用 slim;sandbox 镜像待拉
    sid = "poc-final-demo"
    try:
        print("[1/6] 起容器..."); mgr.acquire(sid, gpu=False)
        print("[2/6] 装 aerosandbox(约3分钟)...")
        r = mgr.exec(sid, "pip install --quiet aerosandbox && echo OK", workdir="/tmp")
        assert r.stdout.strip().endswith("OK"), "装包失败"
        print("[3/6] 拷入 run_aero 替身...")
        mgr.put_file(sid, "/workspace/llt.py", Path(__file__).parent.joinpath("aero/llt.py").read_bytes())
        print("[4/6] 模拟 agent 现写参数扫描脚本,拷入容器...")
        mgr.put_file(sid, "/workspace/agent_sweep.py", AGENT_GENERATED_SWEEP.encode())
        print("[5/6] 容器内执行 agent 现写脚本(展弦比寻优):")
        print("-" * 50)
        r = mgr.exec(sid, "cd /workspace && python agent_sweep.py 2>&1 | grep -v Warning")
        print(r.stdout)
        print("-" * 50)
        print(f"[6/6] 完成,exit={r.exit_code}")
    finally:
        mgr.release(sid, destroy=True)
        print("[done] 容器已回收")


if __name__ == "__main__":
    main()
