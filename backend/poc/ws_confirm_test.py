"""工具前置确认测试(§5.4,标准模式首次确认)。

流程(标准模式,默认):
  1. 连 WS,先 set_mode standard
  2. 发触发 run_sweep 的消息 → agent 调用前应暂停 → 收 action_required
  3. 发 confirm(approved) → 工具执行 → 收 tool_end → done
  4. (可选)再发一次扫描 → 标准模式第二次不再确认(直接执行)
"""
import asyncio
import json
import sys
import websockets

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

URL = "ws://127.0.0.1:8000/ws/chat"


async def recv_event(ws, timeout=120):
    raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
    return json.loads(raw)


async def main():
    print("=== 工具确认测试(标准模式) ===")
    async with websockets.connect(URL, open_timeout=30) as ws:
        # 标准模式是默认,直接发触发扫描的消息(范围小,快)
        await ws.send(json.dumps({"message": "扫展弦比6到8,面积10,步长1,找最优升阻比"}))
        await recv_event(ws)  # session_started

        print("[1] 等待 action_required(agent 应在调工具前暂停)...")
        got_action = False
        action_id = None
        # 收事件直到 action_required 或 tool_start
        for _ in range(50):
            event = await recv_event(ws)
            t = event["type"]
            if t == "action_required":
                got_action = True
                action_id = event["action_id"]
                print(f"    ✅ 收到 action_required: tool={event['tool']} args={event['args']} id={action_id}")
                break
            elif t == "tool_start":
                print(f"    ⚠️ 直接到 tool_start: name={event.get('name')}(若是 run_aero_tool 则不需确认,正常)")
                # 不 break,继续看是否有 action_required(sweep 可能稍后调)
                continue
            elif t in ("done", "error"):
                print(f"    意外 {t}: {event}")
                return

        if got_action:
            print("[2] 发 confirm(approved=True)")
            await ws.send(json.dumps({"type": "confirm", "action_id": action_id, "approved": True}))
            print("[3] 等待工具执行 → tool_end → done...")
            got_tool_end = False
            for _ in range(100):
                event = await recv_event(ws)
                t = event["type"]
                if t == "tool_start":
                    print(f"    tool_start: {event.get('name')}")
                elif t == "tool_end":
                    got_tool_end = True
                    print(f"    tool_end: {str(event.get('content',''))[:80]}...")
                elif t == "done":
                    print(f"    done")
                    break
                elif t == "error":
                    print(f"    error: {event}")
                    break
            print(f"\n=== {'✅ 确认流程通过' if got_tool_end else '⚠️ 未收到 tool_end'} ===")
        else:
            print("\n⚠️ 未触发确认流程(可能 agent 未调工具或已是非首次)")


asyncio.run(main())
