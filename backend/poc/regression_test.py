"""V1 端到端回归测试(§10 第8步)。

一条 WS 连接依次验证:
  ① 基础对话(发消息→token→done)
  ② 工具调用(run_aero→tool_start/tool_end)
  ④ 中止(cancel→interrupted)
  ⑤ 模型切换(set_model→model_changed)
每项打印 ✓/✗,汇总结果。

③ 防护确认/⑥ 失败恢复/⑦ DB落库 由专项脚本/手动验证。
"""
import asyncio
import json
import sys
import time
import websockets

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

URL = "ws://127.0.0.1:8000/ws/chat"
results = []


def mark(name, ok, detail=""):
    results.append((name, ok))
    print(f"  {'✓' if ok else '✗'} {name} {detail}")


async def recv_until(ws, want_type, timeout=120):
    """收事件直到指定 type,返回该事件(中途收集其他类型)。"""
    t0 = time.time()
    while time.time() - t0 < timeout:
        raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
        event = json.loads(raw)
        if event["type"] == want_type:
            return event
        if event["type"] == "error":
            return event
    return {"type": "timeout"}


async def recv_collect(ws, stop_on=("done", "error"), timeout=120):
    """收事件直到 stop_on,返回所有事件列表。"""
    events = []
    t0 = time.time()
    while time.time() - t0 < timeout:
        raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
        event = json.loads(raw)
        events.append(event)
        if event["type"] in stop_on:
            break
    return events


async def main():
    print("=" * 60)
    print("V1 端到端回归测试")
    print("=" * 60)
    async with websockets.connect(URL, open_timeout=30) as ws:
        # —— ① 基础对话 ——
        print("\n[① 基础对话]")
        await ws.send(json.dumps({"message": "1+1=?只回数字"}))
        await recv_until(ws, "session_started")
        events = await recv_collect(ws)
        tokens = [e for e in events if e["type"] == "token"]
        has_done = any(e["type"] == "done" for e in events)
        mark("收到 token 流", len(tokens) > 0, f"({len(tokens)} 个)")
        mark("收到 done", has_done)

        # —— ② 工具调用 ——
        print("\n[② 工具调用 run_aero]")
        await ws.send(json.dumps({"message": "算翼展10米、面积10平米、迎角3度的升阻比"}))
        events = await recv_collect(ws)
        tool_starts = [e for e in events if e["type"] == "tool_start"]
        tool_ends = [e for e in events if e["type"] == "tool_end"]
        mark("tool_start", len(tool_starts) > 0, tool_starts[0].get("name", "") if tool_starts else "")
        mark("tool_end(有结果)", len(tool_ends) > 0, str(tool_ends[0].get("content", ""))[:40] if tool_ends else "")

        # —— ⑤ 模型切换 ——
        print("\n[⑤ 模型切换]")
        await ws.send(json.dumps({"type": "set_model", "model": "MiniMax-M-2.7"}))
        ev = await recv_until(ws, "model_changed", timeout=15)
        mark("set_model 生效", ev["type"] == "model_changed", ev.get("model", ""))
        # 切回
        await ws.send(json.dumps({"type": "set_model", "model": "deepseek-v4-flash"}))
        await recv_until(ws, "model_changed", timeout=15)

        # —— ④ 中止 ——
        print("\n[④ 中止]")
        await ws.send(json.dumps({"message": "详细解释气动升力线理论的完整推导过程,越长越好"}))
        await asyncio.sleep(2)  # 让 agent 跑起来
        await ws.send(json.dumps({"type": "cancel"}))
        ev = await recv_until(ws, "interrupted", timeout=15)
        mark("cancel → interrupted", ev["type"] == "interrupted", ev.get("reason", ""))

    # —— 汇总 ——
    print("\n" + "=" * 60)
    passed = sum(1 for _, ok in results if ok)
    total = len(results)
    print(f"回归结果: {passed}/{total} 通过")
    for name, ok in results:
        print(f"  {'✓' if ok else '✗'} {name}")
    print("=" * 60)


asyncio.run(main())
