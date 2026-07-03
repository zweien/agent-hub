"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ===== WS 事件类型(与后端协议对应) =====
export type WsEvent =
  | { type: "session_started"; session_id: string }
  | { type: "replay"; events: WsEvent[] }
  | { type: "message_in"; content: string }
  | { type: "token"; content: string }
  | { type: "tool_start"; name: string; args?: Record<string, unknown> }
  | { type: "tool_end"; name: string; content: string }
  | { type: "action_required"; action_id: string; tool: string; args: Record<string, unknown> }
  | { type: "action_resolved"; action_id: string; approved: boolean }
  | { type: "takeover_ready"; sandbox_url: string }
  | { type: "takeover_begin" }
  | { type: "takeover_end" }
  | { type: "mode_changed"; mode: string }
  | { type: "interrupted"; reason: string; action_id?: string; options?: string[] }
  | { type: "recover"; action: string }
  | { type: "done" }
  | { type: "error"; message: string };

// ===== 消息状态(渲染用) =====
export interface ToolCall {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  status: "running" | "done";
  result?: string;
}

export interface ChatMessage {
  id: string;
  from: "user" | "assistant";
  content: string;
  tools: ToolCall[];
  pendingConfirm?: { action_id: string; tool: string; args: Record<string, unknown> };
  interrupted?: { reason: string; action_id?: string };
}

export type ConnStatus = "connecting" | "ready" | "streaming" | "error";

let msgIdCounter = 0;
const nextId = () => `m${++msgIdCounter}`;

export function useChatSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [sandboxUrl, setSandboxUrl] = useState<string | null>(null);
  const [takeoverActive, setTakeoverActive] = useState(false);
  // 当前 AI 消息 id(流式追加用)
  const currentAiId = useRef<string | null>(null);

  const connect = useCallback(() => {
    if (!url) return;  // 未登录时不连
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => setStatus("ready");
    ws.onclose = () => setStatus("connecting");
    ws.onerror = () => setStatus("error");
    ws.onmessage = (e) => {
      const event: WsEvent = JSON.parse(e.data);
      handleEvent(event);
    };
  }, [url]);

  const handleEvent = useCallback((event: WsEvent) => {
    switch (event.type) {
      case "session_started":
        break;
      case "token": {
        setStatus("streaming");
        setMessages((prev) => {
          // 追加到当前 AI 消息(无则新建)
          let aiId = currentAiId.current;
          let next = prev;
          if (!aiId || !prev.find((m) => m.id === aiId)) {
            aiId = nextId();
            currentAiId.current = aiId;
            next = [...prev, { id: aiId, from: "assistant" as const, content: "", tools: [] }];
          }
          return next.map((m) =>
            m.id === aiId ? { ...m, content: m.content + event.content } : m
          );
        });
        break;
      }
      case "tool_start": {
        const tid = nextId();
        setMessages((prev) => {
          let aiId = currentAiId.current;
          let next = prev;
          if (!aiId || !prev.find((m) => m.id === aiId)) {
            aiId = nextId();
            currentAiId.current = aiId;
            next = [...prev, { id: aiId, from: "assistant" as const, content: "", tools: [] }];
          }
          return next.map((m) =>
            m.id === aiId
              ? { ...m, tools: [...m.tools, { id: tid, name: event.name, args: event.args, status: "running" as const }] }
              : m
          );
        });
        break;
      }
      case "tool_end": {
        setMessages((prev) =>
          prev.map((m) => ({
            ...m,
            tools: m.tools.map((t) =>
              t.name === event.name && t.status === "running"
                ? { ...t, status: "done" as const, result: event.content }
                : t
            ),
          }))
        );
        break;
      }
      case "action_required": {
        setMessages((prev) => {
          const aiId = currentAiId.current;
          if (!aiId) return prev;
          return prev.map((m) =>
            m.id === aiId
              ? { ...m, pendingConfirm: { action_id: event.action_id, tool: event.tool, args: event.args } }
              : m
          );
        });
        break;
      }
      case "takeover_ready": {
        setSandboxUrl(event.sandbox_url);
        setTakeoverActive(true);
        break;
      }
      case "takeover_end": {
        setTakeoverActive(false);
        break;
      }
      case "interrupted": {
        setMessages((prev) => {
          const aiId = currentAiId.current;
          if (!aiId) return prev;
          return prev.map((m) =>
            m.id === aiId ? { ...m, interrupted: { reason: event.reason, action_id: event.action_id } } : m
          );
        });
        break;
      }
      case "done": {
        setStatus("ready");
        currentAiId.current = null;
        break;
      }
      case "error":
        setStatus("error");
        break;
    }
  }, []);

  // 上行:发消息
  const sendMessage = useCallback((text: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // 本地先加用户消息
    setMessages((prev) => [...prev, { id: nextId(), from: "user", content: text, tools: [] }]);
    currentAiId.current = null;
    ws.send(JSON.stringify({ message: text }));
  }, []);

  // 上行:工具确认
  const confirm = useCallback((action_id: string, approved: boolean, args?: Record<string, unknown>) => {
    wsRef.current?.send(JSON.stringify({ type: "confirm", action_id, approved, args }));
    // 清除 pendingConfirm
    setMessages((prev) => prev.map((m) => (m.pendingConfirm ? { ...m, pendingConfirm: undefined } : m)));
  }, []);

  // 上行:失败恢复
  const recover = useCallback((action: string) => {
    wsRef.current?.send(JSON.stringify({ type: "recover", action }));
    setMessages((prev) => prev.map((m) => (m.interrupted ? { ...m, interrupted: undefined } : m)));
  }, []);

  // 上行:接管
  const takeover = useCallback((begin: boolean) => {
    wsRef.current?.send(JSON.stringify({ type: begin ? "takeover_begin" : "takeover_end" }));
  }, []);

  // 上行:中止当前执行(§8)
  const cancel = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "cancel" }));
  }, []);

  // 上行:切换模型(§8)
  const setModel = useCallback((model: string) => {
    wsRef.current?.send(JSON.stringify({ type: "set_model", model }));
  }, []);

  // 上行:选择工具(§8)
  const setTools = useCallback((tools: string[]) => {
    wsRef.current?.send(JSON.stringify({ type: "set_tools", tools }));
  }, []);

  // 上行:切换防护模式(§5.4/§8)
  const setGuardMode = useCallback((mode: string) => {
    wsRef.current?.send(JSON.stringify({ type: "set_mode", mode }));
  }, []);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  return { messages, status, sandboxUrl, takeoverActive, sendMessage, confirm, recover, takeover, cancel, setModel, setTools, setGuardMode };
}
