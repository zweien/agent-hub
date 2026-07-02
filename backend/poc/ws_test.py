"""WebSocket 流式测试客户端(临时)。连 /ws/chat,发消息,打印收到的事件。"""
import asyncio
import json
import sys
import websockets

# Windows: ProactorEventLoop 与 websockets 不兼容,改用 SelectorEventLoop
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


async def main():
    uri = "ws://127.0.0.1:8000/ws/chat"
    msg = "帮我算翼展10米、面积10平米、迎角3度的机翼升阻比"
    token_count = 0
    tool_events = []
    async with websockets.connect(uri, open_timeout=30, ping_interval=20) as ws:
        await ws.send(json.dumps({"message": msg}))
        print(f">>> 发送: {msg}\n<<< 事件流:")
        async for raw in ws:
            event = json.loads(raw)
            t = event.get("type")
            if t == "token":
                token_count += 1
                print(event["content"], end="", flush=True)
            elif t == "tool_start":
                tool_events.append(("start", event["name"]))
                print(f"\n  [TOOL_START] {event['name']} args={event.get('args')}")
            elif t == "tool_end":
                tool_events.append(("end", event["name"]))
                c = event["content"]
                print(f"  [TOOL_END] {event['name']}: {c[:120]}...")
            elif t == "done":
                print(f"\n\n<<< done")
                break
            elif t == "error":
                print(f"\n<<< ERROR: {event['message']}")
                break
    print(f"\n=== 统计: token 事件 {token_count} 个, 工具事件 {len(tool_events)} 个 ===")


asyncio.run(main())
