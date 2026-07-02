"""气动工具(§4.1 替身 + §2.1 动作型工具)。

迁移自 poc/aero/llt.py + poc/tools/run_aero_mcp.py,去掉 sys.path hack。

两职责:
  1. run_aero() — AeroSandbox VLM 气动核心(纯函数,POC 已验证物理正确)
  2. run_aero_tool — LangChain @tool 包装,供 agent function-calling
"""
from __future__ import annotations

import numpy as np
import aerosandbox as asb
from langchain_core.tools import tool


def run_aero(
    *,
    span: float = 10.0,
    area: float = 10.0,
    alpha_deg: float = 3.0,
    cd0: float = 0.01,
    n_segs: int = 8,
) -> dict:
    """
    AeroSandbox VLM 计算机翼气动特性(POC 已对照椭圆解析解校验)。

    返回: CL, CDi, CD_total, L_D, Oswald_e, span_eff, AR
    """
    b = span
    S = area
    AR = b * b / S

    # 半翼椭圆弦长分布(对称构造)
    ys = np.linspace(0, b / 2, n_segs + 1)
    chords = (4.0 * S) / (np.pi * b) * np.sqrt(np.clip(1.0 - (2 * ys / b) ** 2, 1e-9, None))

    af = asb.Airfoil("naca0012")
    xsecs = [asb.WingXSec(xyz_le=[0, ys[i], 0], chord=chords[i], airfoil=af) for i in range(len(ys))]
    wing = asb.Wing(name="wing", xsecs=xsecs, symmetric=True)
    airplane = asb.Airplane(wings=[wing])

    op = asb.OperatingPoint(velocity=1.0, alpha=alpha_deg)
    vlm = asb.VortexLatticeMethod(
        airplane=airplane, op_point=op,
        spanwise_resolution=max(n_segs, 10), chordwise_resolution=4,
    )
    res = vlm.run()

    CL = float(res["CL"])
    CDi = float(res["CD"])  # VLM 输出的 CD 即诱导阻力(无寄生设定)
    CD_total = cd0 + CDi
    L_D = float(CL / CD_total) if CD_total > 1e-12 else 0.0
    Oswald_e = float(CL ** 2 / (np.pi * AR * CDi)) if CDi > 1e-12 else 1.0

    return {
        "CL": CL, "CDi": CDi, "CD0": float(cd0), "CD_total": CD_total,
        "L_D": L_D, "Oswald_e": Oswald_e, "span_eff": Oswald_e, "AR": float(AR),
    }


@tool
def run_aero_tool(span: float, area: float, alpha_deg: float) -> dict:
    """计算机翼气动特性(升力系数CL、诱导阻力CDi、升阻比L_D、Oswald效率)。
    参数: span翼展(米), area机翼面积(平方米), alpha_deg迎角(度)。
    用于单次气动分析。"""
    r = run_aero(span=span, area=area, alpha_deg=alpha_deg)
    return {k: v for k, v in r.items()}
