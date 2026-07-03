"""
§5.2 回归用例(可重复、有断言、失败即非零退出)。

已知正确答案(气动学基本结论,§4.1 替身必须复现):
  用例 A:固定面积,展弦比 AR 6→14 → 升阻比 L/D 单调上升
          (大展弦比降低诱导阻力)。
  用例 B:固定几何,迎角 0→5° → CL 单调上升且近似线性
          (薄翼理论 CL≈2π·α/(1+2/AR))。
  用例 C:数值 CL/CDi 对照椭圆解析解,相对误差 < 15%
          (VLM 自身精度量级)。

跑法: python sweep.py   (退出码 0=全过, 1=有失败)
"""
import sys
sys.path.insert(0, ".")
import numpy as np
from llt import run_aero

failures: list[str] = []


def check(name: str, ok: bool, detail: str = ""):
    print(f"  {'✓' if ok else '✗'} {name} {detail}")
    if not ok:
        failures.append(name)


print("=" * 60)
print("用例 A:展弦比↑ → 升阻比↑(单调)")
print("=" * 60)
area = 10.0
print(f"{'AR':>6} {'L_D':>8} {'CL':>8} {'CDi':>9}")
ld_by_ar: list[tuple[int, float]] = []
for AR in [6, 8, 10, 12, 14]:
    span = (AR * area) ** 0.5
    r = run_aero(span=span, area=area, alpha_deg=3.0)
    ld_by_ar.append((AR, r["L_D"]))
    print(f"{AR:>6} {r['L_D']:>8.2f} {r['CL']:>8.4f} {r['CDi']:>9.5f}")
lds = [ld for _, ld in ld_by_ar]
check("L/D 随 AR 单调上升", all(lds[i] <= lds[i + 1] + 1e-9 for i in range(len(lds) - 1)),
      f"(AR6={lds[0]:.2f} → AR14={lds[-1]:.2f})")
check("AR14 升阻比显著高于 AR6", lds[-1] > lds[0] * 1.2)

print()
print("=" * 60)
print("用例 B:迎角↑ → CL 单调近似线性↑")
print("=" * 60)
print(f"{'alpha':>6} {'CL':>8}")
cls = []
for alpha in [0, 1, 2, 3, 4, 5]:
    r = run_aero(span=10.0, area=10.0, alpha_deg=alpha)
    cls.append(r["CL"])
    print(f"{alpha:>5}° {r['CL']:>8.4f}")
check("CL 随迎角单调上升", all(cls[i] <= cls[i + 1] + 1e-9 for i in range(len(cls) - 1)))
# 线性度:相邻 CL 差值的标准差 / 均值 < 15%
diffs = [cls[i + 1] - cls[i] for i in range(len(cls) - 1)]
mean_d = np.mean(diffs)
linear_err = float(np.std(diffs) / mean_d) if mean_d > 0 else 1.0
check(f"CL 近似线性(斜率抖动 {linear_err * 100:.1f}% < 15%)", linear_err < 0.15)

print()
print("=" * 60)
print("用例 C:对照椭圆解析解(精度)")
print("=" * 60)
res = run_aero(span=10.0, area=10.0, alpha_deg=3.0)
AR = res["AR"]; alpha = np.radians(3.0); a0 = 2 * np.pi
CL_th = a0 * alpha / (1 + a0 / (np.pi * AR))
CDi_th = CL_th ** 2 / (np.pi * AR)
cl_err = abs(res["CL"] - CL_th) / CL_th
cdi_err = abs(res["CDi"] - CDi_th) / CDi_th if CDi_th > 0 else 1.0
print(f"  CL  数值={res['CL']:.4f} 解析={CL_th:.4f} err={cl_err * 100:.1f}%")
print(f"  CDi 数值={res['CDi']:.5f} 解析={CDi_th:.5f} err={cdi_err * 100:.1f}%")
check(f"CL 相对解析解 err<15%({cl_err * 100:.1f}%)", cl_err < 0.15)
check(f"CDi 相对解析解 err<15%({cdi_err * 100:.1f}%)", cdi_err < 0.15)

print()
print("=" * 60)
if failures:
    print(f"❌ 回归失败 {len(failures)} 项:{failures}")
    sys.exit(1)
else:
    print("✅ §5.2 回归全过(3 用例 / 7 断言)")
    sys.exit(0)

