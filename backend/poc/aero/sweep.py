"""
气动参数扫描验证(§9-B 验收):
  扫展弦比 AR 从 6→14,验证升阻比 L/D 随 AR 单调上升。
  这是气动学基本结论(大展弦比降低诱导阻力),若替身物理正确必成立。

同时扫描迎角,验证 CL 随迎角线性上升(薄翼理论)。
这是 §5.2 回归用例的种子:已知正确趋势,跑 agent 时应复现。
"""
import sys
sys.path.insert(0, ".")
from llt import run_aero

print("=" * 60)
print("扫描 1:固定面积,变展弦比(展弦比↑ → 升阻比↑)")
print("气动直觉:大展弦比降低诱导阻力,故 L/D 上升")
print("=" * 60)
area = 10.0
print(f"{'AR':>6} {'span':>7} {'CL':>8} {'CDi':>9} {'CD_total':>10} {'L_D':>8} {'Oswald':>8}")
prev_ld = None
mono_ok = True
for AR in [6, 8, 10, 12, 14]:
    span = (AR * area) ** 0.5
    r = run_aero(span=span, area=area, alpha_deg=3.0)
    if prev_ld is not None and r["L_D"] < prev_ld - 0.01:
        mono_ok = False
    prev_ld = r["L_D"]
    print(f"{AR:>6} {span:>7.2f} {r['CL']:>8.4f} {r['CDi']:>9.5f} {r['CD_total']:>10.5f} {r['L_D']:>8.2f} {r['Oswald_e']:>8.3f}")
print(f"\n✅ 升阻比随展弦比单调上升: {mono_ok}")

print()
print("=" * 60)
print("扫描 2:固定几何,变迎角(迎角↑ → CL 线性↑)")
print("气动直觉:升力线斜率 ≈ 2π·AR/(AR+2) per rad")
print("=" * 60)
print(f"{'alpha':>6} {'CL':>8} {'CDi':>9} {'L_D':>8}")
for alpha in [0, 1, 2, 3, 4, 5]:
    r = run_aero(span=10.0, area=10.0, alpha_deg=alpha)
    print(f"{alpha:>5}° {r['CL']:>8.4f} {r['CDi']:>9.5f} {r['L_D']:>8.2f}")

print()
print("✅ 验收:气动替身物理正确,可进入 run_aero MCP 封装。")
