"""创建 UAV 设计领域的工具/skill 示例(演示平台能力)。

工具(4 类全覆盖):
  - python: 翼载荷估算、电池续航估算
  - bash:   系统信息查询(演示 bash 工具)
  - web:    公开 API 查询(IP 归属,演示 web 工具)
  - mcp:    已有 mcp_math(数学运算)

Skill(领域知识 + 流程):
  - 无人机总体设计流程
  - 电池选型指南
"""
import json
import urllib.request

BASE = "http://127.0.0.1:8000"


def http(path, data=None, token=None, method="GET"):
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(f"{BASE}{path}", data=body, headers=h, method=method)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, json.loads(r.read())


bt = http("/auth/login", {"username": "builder", "password": "builder123"}, method="POST")[1]["token"]


# ============ 工具 ============
tools = [
    {
        "name": "wing_loading",
        "description": "估算无人机翼载荷。输入起飞重量(kg)和机翼面积(m²),返回翼载荷(kg/m²)并给出设计评价。",
        "type": "python",
        "config": {
            "code": (
                "wl = mtow / wing_area\n"
                "if wl < 10:\n"
                "    cat = '轻型(滑翔机/小型无人机),翼载荷低,低速性能好'\n"
                "elif wl < 50:\n"
                "    cat = '中型(侦察/运输),翼载荷适中'\n"
                "elif wl < 200:\n"
                "    cat = '重型(大型无人机/运输机),需要较高起飞速度'\n"
                "else:\n"
                "    cat = '超重型'\n"
                "print(f'翼载荷 = {wl:.2f} kg/m²')\n"
                "print(f'类别: {cat}')\n"
            ),
            "workdir": "/tmp",
        },
        "params_schema": {
            "type": "object",
            "properties": {
                "mtow": {"type": "number", "description": "最大起飞重量(kg)"},
                "wing_area": {"type": "number", "description": "机翼面积(m²)"},
            },
            "required": ["mtow", "wing_area"],
        },
        "is_published": True,
    },
    {
        "name": "battery_endurance",
        "description": "估算电动无人机续航时间。输入电池容量(mAh)、电压(V)、平均电流(mA),返回续航时间(分钟)。",
        "type": "python",
        "config": {
            "code": (
                "# 续航 = 容量 / 电流 × 60(分钟),× 0.8(放电效率)\n"
                "endurance_min = (capacity / avg_current) * 60 * 0.8\n"
                "print(f'电池容量: {capacity} mAh @ {voltage}V')\n"
                "energy_wh = capacity * voltage / 1e6\n"
                "print(f'能量: {energy_wh:.1f} Wh')\n"
                "print(f'估算续航: {endurance_min:.1f} 分钟 ({endurance_min/60:.2f} 小时)')\n"
            ),
            "workdir": "/tmp",
        },
        "params_schema": {
            "type": "object",
            "properties": {
                "capacity": {"type": "number", "description": "电池容量(mAh)"},
                "voltage": {"type": "number", "description": "标称电压(V)"},
                "avg_current": {"type": "number", "description": "悬停/巡航平均电流(mA)"},
            },
            "required": ["capacity", "voltage", "avg_current"],
        },
        "is_published": True,
    },
    {
        "name": "sys_info",
        "description": "查询沙箱环境的系统信息(CPU/内存/操作系统),用于环境诊断。",
        "type": "bash",
        "config": {
            "code": 'echo "=== OS ==="; uname -a; echo "=== CPU ==="; nproc; echo "=== MEM ==="; free -h 2>/dev/null || cat /proc/meminfo | head -3',
            "workdir": "/tmp",
        },
        "params_schema": {},
        "is_published": True,
    },
    {
        "name": "ip_lookup",
        "description": "查询公网 IP 的归属地信息(经 httpbin API),用于网络诊断。",
        "type": "web",
        "config": {
            "url": "https://ipinfo.io/json",
            "method": "GET",
            "headers": {},
        },
        "params_schema": {},
        "is_published": True,
    },
]

print("=== 创建工具 ===")
for t in tools:
    try:
        c, r = http("/tools", t, token=bt, method="POST")
        print(f"  [{'✓' if c==200 else '✗'}] {t['name']} ({t['type']}) → {r.get('id','') if isinstance(r,dict) else str(r)[:50]}")
    except Exception as e:
        # 已存在则跳过
        print(f"  [skip] {t['name']}: {str(e)[:60]}")


# ============ Skill ============
skills = [
    {
        "name": "uav-design-workflow",
        "description": "无人机总体设计流程与参数权衡指南。涉及需求分析、气动布局、动力选型、续航估算时使用。",
        "content": (
            "# 无人机总体设计流程\n\n"
            "## 设计阶段\n"
            "1. **需求分析**:任务类型(侦察/运输/攻击)→ 航程、载重、速度、续航指标\n"
            "2. **气动布局**:常规布局/飞翼/鸭翼;展弦比、面积、后掠角\n"
            "3. **动力选型**:电动(螺旋桨)/油动(涡喷);推重比 > 1.2(机动)/0.3(巡航)\n"
            "4. **续航估算**:电池能量 / 平均功率(可用 battery_endurance 工具)\n"
            "5. **结构重量**:系数法 MTOW × 0.25~0.35(复合材料)\n\n"
            "## 关键权衡\n"
            "- 展弦比↑ → 升阻比↑ 但结构重量↑\n"
            "- 翼载荷低 → 起降速度低但抗风差(可用 wing_loading 工具评估)\n"
            "- 电池能量密度:锂电池 ~250 Wh/kg,影响续航上限\n\n"
            "## 经验值\n"
            "- 小型电动侦察机:MTOW 2-5kg,续航 30-90min,翼载荷 5-15 kg/m²\n"
            "- 中型运输:MTOW 50-200kg,续航 2-6h,翼载荷 30-80 kg/m²"
        ),
        "is_published": True,
    },
    {
        "name": "battery-selection",
        "description": "无人机电池选型指南。涉及锂电池容量、放电倍率、电压配置时使用。",
        "content": (
            "# 电池选型指南\n\n"
            "## 锂电池关键参数\n"
            "- **容量 (mAh)**:决定续航。容量 = 平均电流 × 续航时间 / 0.8(放电效率)\n"
            "- **放电倍率 (C)**:最大电流 = 容量(Ah) × C 值。悬停电流的 2 倍以上为安全\n"
            "- **电压 (V)**:单节 3.7V(标称)。3S=11.1V,4S=14.8V,6S=22.2V\n"
            "- **能量密度**:锂聚 ~200 Wh/kg,锂离子 ~250 Wh/kg\n\n"
            "## 选型流程\n"
            "1. 测悬停电流 → 确定持续放电需求\n"
            "2. 按目标续航算容量(可用 battery_endurance 工具反推)\n"
            "3. 选 C 值:最大电流 ≥ 悬停电流 × 2(机动余量)\n"
            "4. 验证重量:电池重量 ≤ MTOW × 40%\n\n"
            "## 常见配置\n"
            "- 250 穿越机:4S 1500mAh 75C\n"
            "- 侦察机(2kg):6S 5000mAh 25C\n"
            "- 测绘机(5kg):6S 16000mAh 10C"
        ),
        "is_published": True,
    },
    {
        "name": "aero-design-tips",
        "description": "气动设计经验法则与常见陷阱。涉及翼型选择、展弦比、扭转、翼尖装置时使用。",
        "content": (
            "# 气动设计经验法则\n\n"
            "## 翼型选择\n"
            "- **低速(Re<1e5)**:SD7003、S1223(高升力)\n"
            "- **中速(1e5<Re<1e6)**:Clark Y、NACA 4 位(通用)\n"
            "- **层流翼型**:NACA 6 系,需表面光洁\n\n"
            "## 展弦比 (AR)\n"
            "- AR = 翼展²/面积。诱导阻力 ∝ 1/AR\n"
            "- 滑翔机 AR > 20,运输机 AR ~8-10,战斗机 AR ~3-5\n"
            "- AR↑ 的代价:结构重量、翼根弯矩\n\n"
            "## 常见陷阱\n"
            "1. **忽视雷诺数效应**:低速翼型在高速未必好\n"
            "2. **扭转过大**:导致副翼反效\n"
            "3. **翼尖失速**:根梢比 < 0.5 时翼尖先失速,加 2-3° 外洗\n"
            "4. **忽视接地面积**:机身/挂架阻力常被低估,占总阻力 20-30%"
        ),
        "is_published": True,
    },
]

print("\n=== 创建 Skill ===")
for s in skills:
    try:
        c, r = http("/skills", s, token=bt, method="POST")
        print(f"  [{'✓' if c==200 else '✗'}] {s['name']} → {r.get('id','') if isinstance(r,dict) else str(r)[:50]}")
    except Exception as e:
        print(f"  [skip] {s['name']}: {str(e)[:60]}")


# ============ 汇总 ============
print("\n=== 最终资产 ===")
c, tools = http("/tools", token=bt)
print("工具:")
for t in tools:
    print(f"  [{t['type']:7s}] {t['name']}: {t.get('description','')[:50]}")
c, skills = http("/skills", token=bt)
print("技能:")
for s in skills:
    print(f"  {s['name']}: {s.get('description','')[:50]}")
