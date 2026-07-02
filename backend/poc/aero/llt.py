"""
气动替身:基于 AeroSandbox 的涡格法(VLM)机翼气动分析。
用于 POC 替代真实 CFD/VSPAero(见 V1 文档 §4.1)。

为什么用 AeroSandbox 而非自写 LLT:
  自写升力线影响系数极易出错(POC 期间两次验证失败),而 AeroSandbox 的
  VortexLatticeMethod 是经过验证的开源实现。已对照椭圆机翼解析解校验:
    AR=10, alpha=3deg → CL≈0.263(解析0.274), CDi≈0.0022(解析0.0024),误差<10%。

输出(有气动学理的量,非玩具公式):
  CL, CDi, CD_total, L_D, Oswald_e, span_eff, AR
  (展向分布等可后续按需补)
"""
from __future__ import annotations

import numpy as np
import aerosandbox as asb


def run_aero(
    *,
    span: float = 10.0,
    area: float = 10.0,
    alpha_deg: float = 3.0,
    cd0: float = 0.01,
    n_segs: int = 8,
) -> dict:
    """
    用 AeroSandbox VLM 计算机翼气动特性。

    参数:
      span:    翼展 (m)
      area:    机翼面积 (m^2)
      alpha_deg: 迎角 (deg)
      cd0:     寄生阻力系数(VLM 只算诱导,总阻力 = cd0 + CDi)
      n_segs:  半翼展向分段数(越多越准,越慢;POC 用 8)

    返回: dict(CL, CDi, CD_total, L_D, Oswald_e, span_eff, AR)
    """
    b = span
    S = area
    AR = b * b / S

    # 半翼几何(对称构造):沿 y 用椭圆弦长分布(经典基准,解析可验)
    ys = np.linspace(0, b / 2, n_segs + 1)
    chords = (4.0 * S) / (np.pi * b) * np.sqrt(np.clip(1.0 - (2 * ys / b) ** 2, 1e-9, None))

    # 用对称翼:给半翼定义 + symmetric=True,VLM 自动镜像
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
        "CL": CL,
        "CDi": CDi,
        "CD0": float(cd0),
        "CD_total": CD_total,
        "L_D": L_D,
        "Oswald_e": Oswald_e,
        "span_eff": Oswald_e,
        "AR": float(AR),
    }


def _self_check():
    """对照椭圆机翼解析解(§5.2 回归种子)。"""
    res = run_aero(span=10.0, area=10.0, alpha_deg=3.0)
    AR = res["AR"]; alpha = np.radians(3.0); a0 = 2 * np.pi
    CL_th = a0 * alpha / (1 + a0 / (np.pi * AR))
    CDi_th = CL_th ** 2 / (np.pi * AR)
    print(f"AR            = {AR:.2f}")
    print(f"CL  数值={res['CL']:.4f}   解析={CL_th:.4f}   err={abs(res['CL']-CL_th)/CL_th*100:.1f}%")
    print(f"CDi 数值={res['CDi']:.5f}  解析={CDi_th:.5f}  err={abs(res['CDi']-CDi_th)/CDi_th*100:.1f}%")
    print(f"Oswald_e={res['Oswald_e']:.4f}   椭圆理论≈1.0")
    print(f"CD_total={res['CD_total']:.5f}   L_D={res['L_D']:.2f}")


if __name__ == "__main__":
    _self_check()
