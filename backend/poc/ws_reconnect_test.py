"""断线重连测试(§2.4 会话独立)。

流程:
  1. 连 WS 发消息,收到 session_started + 少量 token 后主动断开
  2. 等 agent 继续跑(事件落 DB)
  3. 重连带 session_id → 应收到 replay 历史 + (可能)后续事件
  4. 查 DB 确认事件完整
"""
import asyncio
import json
import sys
import websockets

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

URL = "ws://127.0.0.1:8000/ws/chat"
MSG = "算翼展10米、面积10平米、迎角3度的机翼升阻比"


async def phase1_connect_disconnect() -> str | None:
    """阶段1:连、发消息、收到 session_started + 几个 token 后断开。返回 session_id。"""
    print("=== 阶段1: 连接 → 发消息 → 收几个事件 → 断开 ===")
    sid = None
    async with websockets.connect(URL, open_timeout=30) as ws:
        await ws.send(json.dumps({"message": MSG}))
        received = 0
        async for raw in ws:
            event = json.loads(raw)
            t = event.get("type")
            if t == "session_started":
                sid = event["session_id"]
                print(f"  session_started: {sid}")
            elif t == "token":
                received += 1
                if received <= 3:
                    print(f"  token#{received}: {event['content'][:30]}", flush=True)
                if received >= 3:  # 收到 3 个 token 就断
                    print(f"  >>> 收到 {received} 个 token,主动断开(agent 应继续)")
                    break
            elif t in ("tool_start", "tool_end"):
                print(f"  {t}: {event.get('name')}")
                break
    return sid


async def phase2_wait_and_reconnect(sid: str):
    """阶段2:等几秒让 agent 跑完,然后重连回放。"""
    print(f"\n=== 阶段2: 等 8 秒(agent 继续跑)后重连 session={sid} ===")
    await asyncio.sleep(8)
    async with websockets.connect(f"{URL}?session_id={sid}", open_timeout=30) as ws:
        # 第一条应是 replay
        raw = await asyncio.wait_for(ws.recv(), timeout=10)
        event = json.loads(raw)
        print(f"  重连首条: type={event.get('type')}")
        if event.get("type") == "replay":
            events = event.get("events", [])
            types = [e["type"] for e in events]
            print(f"  replay 事件数: {len(events)}")
            print(f"  replay 类型: {types}")
            has_done = "done" in types
            has_tool = "tool_end" in types
            print(f"  含 done: {has_done}, 含 tool_end: {has_tool}")
            if not has_done:
                print("  agent 未结束,等待后续事件...")
                async for raw2 in ws:
                    e2 = json.loads(raw2)
                    print(f"  后续: {e2.get('type')}")
                    if e2.get("type") in ("done", "error"):
                        break


async def main():
    sid = await phase1_connect_disconnect()
    if sid:
        await phase2_wait_and_reconnect(sid)
        print("\n=== 验证:查 DB 事件 ===")
        # 通过 API 查不了,这里只打印结论
        print("断线重连测试完成。查 DB 用: docker exec agent-hub-db-1 psql -U agenthub -d agenthub -c \"SELECT seq,type FROM events WHERE session_id='%s' ORDER BY seq\"")


asyncio.run(main())
