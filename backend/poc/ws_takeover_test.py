"""接管测试(§2.3 C1)。

流程:
  1. 连 WS 发消息,agent 开始跑(token 流)
  2. 收几个 token 后发 takeover_begin → agent 应暂停(token 流停)
  3. 收到 takeover_ready(sandbox_url)
  4. 等 3 秒(模拟人在 sandbox 操作),期间应无新 token
  5. 发 takeover_end → agent 应恢复(token 流继续)→ done
"""
import asyncio
import json
import sys
import time
import websockets

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

URL = "ws://127.0.0.1:8000/ws/chat"
MSG = "详细分析翼展10米、面积10平米、迎角3度的机翼气动特性,给出升力系数、阻力系数、升阻比,并解释物理意义"


async def main():
    print("=== 接管测试 ===")
    async with websockets.connect(URL, open_timeout=30) as ws:
        await ws.send(json.dumps({"message": MSG}))
        sid = None
        token_before = 0
        token_during = 0
        token_after = 0
        phase = "before"  # before → takeover → after

        # 阶段1: 收几个 token
        print("[1] 收 token(接管前)...")
        for _ in range(4):
            raw = await asyncio.wait_for(ws.recv(), timeout=30)
            event = json.loads(raw)
            if event["type"] == "session_started":
                sid = event["session_id"]
                print(f"    session: {sid}")
            elif event["type"] == "token":
                token_before += 1
                print(f"    token#{token_before}: {event['content'][:20]}")

        # 阶段2: 发 takeover_begin
        print("[2] 发 takeover_begin(agent 应暂停)")
        await ws.send(json.dumps({"type": "takeover_begin"}))
        # 收 takeover_ready + takeover_begin 事件
        for _ in range(2):
            raw = await asyncio.wait_for(ws.recv(), timeout=10)
            event = json.loads(raw)
            print(f"    收: {event['type']}", json.dumps(event, ensure_ascii=False)[:80])
            if event["type"] == "takeover_ready":
                print(f"    >>> sandbox_url: {event['sandbox_url']}")

        # 阶段3: 等 3 秒,验证无新 token(agent 挂起)
        print("[3] 等 3 秒,验证 agent 暂停(应无 token)...")
        t0 = time.time()
        while time.time() - t0 < 3:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
                event = json.loads(raw)
                if event["type"] == "token":
                    token_during += 1
            except asyncio.TimeoutError:
                pass
        print(f"    接管期间收到 token: {token_during} 个 ({'✅ agent 已暂停' if token_during == 0 else '❌ agent 未暂停'})")

        # 阶段4: 发 takeover_end
        print("[4] 发 takeover_end(agent 应恢复)")
        await ws.send(json.dumps({"type": "takeover_end"}))

        # 阶段5: 收剩余事件直到 done
        print("[5] 收恢复后的事件直到 done...")
        async for raw in ws:
            event = json.loads(raw)
            if event["type"] == "token":
                token_after += 1
            elif event["type"] in ("takeover_begin", "takeover_end"):
                print(f"    {event['type']}")
            elif event["type"] == "done":
                print(f"    done")
                break
            elif event["type"] == "error":
                print(f"    error: {event.get('message')}")
                break
        print(f"    恢复后收到 token: {token_after} 个")

    print(f"\n=== 统计: 接管前 {token_before} / 接管期间 {token_during} / 恢复后 {token_after} ===")
    print(f"{'✅ 接管测试通过' if token_during == 0 and token_after > 0 else '⚠️ 需检查'}")


asyncio.run(main())
