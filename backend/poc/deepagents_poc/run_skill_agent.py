"""Deep Agents + skills 可行性 POC(路线 B 头号风险闸门)。

验证三件事(用真实 DeepSeek endpoint):
  1. deepagents 能否接 OpenAI 兼容的自定义 base_url(非 anthropic/google 原生)
  2. SkillsMiddleware 能否发现并加载本地 SKILL.md(progressive disclosure)
  3. agent 是否真能"按需"读到 skill 内容回答问题(避免全塞 system prompt)

通过 = 路线 B 技术可行,可进入 grilling 后续;失败 = 回路线 A 自建。
"""
import sys
import os
import warnings
warnings.filterwarnings("ignore")  # 屏蔽 pydantic v1/3.14 警告,聚焦功能验证

# 复用现有 .env(LLM endpoint + key,不重复硬编码)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from langchain_openai import ChatOpenAI
from deepagents import create_deep_agent, FilesystemMiddleware
from deepagents.middleware import SkillsMiddleware
from deepagents.backends import LocalShellBackend

BASE_URL = os.getenv("LLM_BASE_URL", "http://192.168.2.220:3000/v1")
API_KEY = os.getenv("LLM_API_KEY", "")
MODEL = os.getenv("LLM_MODEL", "deepseek-v4-flash")
SKILLS_DIR = os.path.join(os.path.dirname(__file__), "skills")

print("=" * 60)
print("Deep Agents + Skills 可行性 POC")
print(f"  endpoint: {BASE_URL}")
print(f"  model:    {MODEL}")
print(f"  skills:   {SKILLS_DIR}")
print("=" * 60)

# ① 用 OpenAI 兼容的 ChatOpenAI 接内网 DeepSeek(deepagents 的 model 参数接受 BaseChatModel)
llm = ChatOpenAI(base_url=BASE_URL, api_key=API_KEY, model=MODEL,
                 max_tokens=4000, temperature=0.3, streaming=True)
print("\n[1] ChatOpenAI 实例化 ✓(接 DeepSeek endpoint)")

# ② SkillsMiddleware:发现本地 skills 目录里的 SKILL.md(progressive disclosure)。
#    关键修正(POC 踩坑):
#      - sources 传【纯路径字符串】,不能传 tuple(tuple 会被当 label→路径反了)
#      - backend 用 LocalShellBackend(真实文件系统),不用 FilesystemBackend virtual
#        (virtual 是空虚拟盘,不会映射 root_dir 物理文件 → agent 读不到 SKILL.md)
fs_backend = LocalShellBackend(root_dir=SKILLS_DIR)
skills_mw = SkillsMiddleware(
    backend=fs_backend,
    sources=[SKILLS_DIR],  # 纯路径字符串(非 tuple)
)
print("[2] SkillsMiddleware(本地 source + LocalShellBackend) ✓")

# ③ 构建 deep agent(只用 skills middleware,避免工具重复)
agent = create_deep_agent(
    model=llm,
    # 强制要求:回答前必须 read_file 读相关技能(验证 progressive disclosure 机制是否通)
    system_prompt=(
        "你是无人系统气动优化助手。\n"
        "【强制规则】回答涉及命名/流程/规范的问题前,必须先用 read_file 工具读取 team-protocol 技能的 SKILL.md 全文,"
        "基于其真实内容回答,不得猜测。"
    ),
    middleware=[skills_mw],
)
print("[3] create_deep_agent ✓\n")

# ④ 跑一个会触发 skill 的问题。
#    用"私有知识"问题(虚构的团队规范 ZW-2026),模型绝不可能凭训练知识答对,
#    只有真去 read_file 读 team-protocol/SKILL.md 才能给正确答案 → 证明 progressive disclosure 生效
QUESTION = "我要提交一个气动方案:展弦比 8、面积 0.5 平米,设计师工号 D1024。文件该怎么命名?校验码是多少?走什么审核流程?"
print(f"[4] 提问(私有知识,验证 skill 按需加载): {QUESTION}\n")
print("-" * 60)

# 流式跑,观察是否出现 read_file 工具调用(= skill 被按需加载)
saw_read_skill = False
final_text = ""
try:
    for chunk in agent.stream(
        {"messages": [("user", QUESTION)]},
        stream_mode=["messages", "updates"],
    ):
        mode, payload = chunk
        if mode == "messages":
            msg, _meta = payload
            content = getattr(msg, "content", "")
            # 检测工具调用(读 skill)
            tcs = getattr(msg, "tool_calls", None)
            if tcs:
                for tc in tcs:
                    name = tc.get("name", "?")
                    args = tc.get("args", {})
                    print(f"  [工具调用] {name}({str(args)[:80]})")
                    if name in ("read_file", "read", "cat") and "SKILL" in str(args):
                        saw_read_skill = True
            if content and not tcs:
                final_text += str(content)
                print(content, end="", flush=True)
        elif mode == "updates" and isinstance(payload, dict):
            for _n, out in payload.items():
                if isinstance(out, dict):
                    for m in out.get("messages", []):
                        if hasattr(m, "content") and m.content and not getattr(m, "tool_calls", None):
                            c = str(m.content)
                            if c not in final_text:
                                final_text += c
except Exception as e:
    print(f"\n\n❌ 运行失败: {type(e).__name__}: {e}")
    import traceback; traceback.print_exc()
    sys.exit(1)

print("\n" + "=" * 60)
print("POC 结论:")
print(f"  agent 真的 read_file 读 SKILL.md(按需激活): {'✅ 是' if saw_read_skill else '⚠️ 否(可能直接答了)'}")
print(f"  产出文本长度: {len(final_text)} 字符")
# 验证回答里有没有用上 skill 里的私有知识(校验码 31200、命名格式、D2001 总师)
hit = sum(kw in final_text for kw in ["31200", "UAV-AERO", "D1024", "D2001", "sftp"])
print(f"  回答含私有知识关键词: {hit}/5(校验码31200/命名UAV-AERO/工号D1024/总师D2001/sftp)")
print("=" * 60)
sys.exit(0 if saw_read_skill or hit >= 2 else 2)
