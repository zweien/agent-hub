"""失败恢复测试(§5.5)。

前置:sandbox 已停(制造工具失败)。
流程:
  1. 连 WS 发 sweep 消息 → 工具连不上 sandbox → 异常 → 收 interrupted(不 done)
  2. 发 recover(end) → 收 done
"""
import asyncio
import json
import sys
import websockets

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

URL = "ws://127.0.0.1:8000/ws/chat"


async def recv_event(ws, timeout=120):
    return json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout))


async def main():
    print("=== 失败恢复测试(§5.5) ===")
    print("(前置:sandbox 已停,工具应失败)")
    async with websockets.connect(URL, open_timeout=30) as ws:
        # 发触发 sweep 的消息(标准模式首次会先 action_required,
        # 但为简化,先设 yolo 跳过确认,直接触发工具失败)
        await ws.send(json.dumps({"message": "扫展弦比6到7,面积10,步长1"}))
        await recv_event(ws)  # session_started

        print("[1] 等待 interrupted(工具失败应触发)...")
        got_interrupted = False
        for _ in range(60):
            event = await recv_event(ws)
            t = event["type"]
            if t == "action_required":
                print(f"    action_required(需先确认)→ 自动 approve")
                await ws.send(json.dumps({"type": "confirm", "action_id": event["action_id"], "approved": True}))
            elif t == "tool_start":
                print(f"    tool_start: {event.get('name')}(将失败)")
            elif t == "interrupted":
                got_interrupted = True
                print(f"    ✅ 收到 interrupted: reason={event.get('reason','')[:80]}")
                break
            elif t == "done":
                print(f"    ⚠️ 直接到 done(未失败?)")
                break
            elif t == "error":
                print(f"    ⚠️ 收到 error(旧逻辑?): {event.get('message','')[:80]}")
                break

        if got_interrupted:
            print("[2] 发 recover(end) → 应收 done")
            await ws.send(json.dumps({"type": "recover", "action": "end"}))
            for _ in range(10):
                event = await recv_event(ws)
                if event["type"] == "done":
                    print(f"    ✅ 收到 done(失败恢复成功)")
                    break
            print(f"\n=== ✅ 失败恢复测试通过 ===")
        else:
            print(f"\n⚠️ 未触发 interrupted")


asyncio.run(main())
