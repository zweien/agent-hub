"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ===== WS 事件类型(与后端协议对应) =====
// 历史事件(get_history 返回):{seq,type,payload,actor};字段值在 payload 内。
export interface HistoryEvent {
  seq: number;
  type: string;
  payload?: Record<string, unknown>;
  actor?: string | null;
}
export type WsEvent =
  | { type: "session_started"; session_id: string }
  | { type: "replay"; events: HistoryEvent[] }
  | { type: "message_in"; content: string }
  | { type: "token"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "todos"; todos: { content: string; status: "pending" | "in_progress" | "completed" }[] }
  | { type: "context_compacted"; summary: string; file_path?: string }
  | { type: "tool_start"; name: string; args?: Record<string, unknown>; is_subagent?: boolean; is_filesystem?: boolean }
  | { type: "tool_end"; name: string; content: string; is_filesystem?: boolean }
  | { type: "action_required"; action_id: string; tool: string; args: Record<string, unknown> }
  | { type: "action_resolved"; action_id: string; approved: boolean }
  | { type: "takeover_ready"; sandbox_url: string }
  | { type: "takeover_begin" }
  | { type: "takeover_end" }
  | { type: "mode_changed"; mode: string }
  | { type: "interrupted"; reason: string; action_id?: string; options?: string[] }
  | { type: "recover"; action: string }
  | { type: "sandbox_exec"; command: string; exit_code: number; stdout: string; stderr: string; duration_s: number }
  | { type: "control_ack"; ok: boolean; message: string }
  | { type: "done" }
  | { type: "error"; message: string };

// ===== 消息状态(渲染用) =====
export interface ToolCall {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  status: "running" | "done";
  result?: string;
  /** deepagents 的 task 工具(子代理委派) */
  is_subagent?: boolean;
  /** deepagents FilesystemMiddleware 注入的文件操作工具 */
  is_filesystem?: boolean;
}

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface SandboxExec {
  command: string;
  exit_code: number;
  stdout: string;
  duration_s: number;
}

export interface ChatMessage {
  id: string;
  from: "user" | "assistant";
  content: string;
  tools: ToolCall[];
  sandboxExecs?: SandboxExec[];
  /** 推理过程(累积;仅推理模型产生,当前 endpoint 可能无) */
  reasoning?: string;
  /** 计划进度(deepagents write_todos 快照,最新覆盖) */
  todos?: TodoItem[];
  /** 上下文已压缩(deepagents SummarizationMiddleware 触发后的提示) */
  compacted?: { summary: string; file_path?: string };
  pendingConfirm?: { action_id: string; tool: string; args: Record<string, unknown> };
  interrupted?: { reason: string; action_id?: string };
}

export type ConnStatus = "connecting" | "ready" | "streaming" | "error";

let msgIdCounter = 0;
const nextId = () => `m${++msgIdCounter}`;

export function useChatSocket(url: string, initialSessionId?: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [sandboxUrl, setSandboxUrl] = useState<string | null>(null);
  const [takeoverActive, setTakeoverActive] = useState(false);
  // 当前会话 id:恢复场景从 URL ?session= 初始化(replay 不发 session_started),
  // 新会话从 session_started 事件捕获;新对话=重连不带 session_id
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId ?? null);
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
        setSessionId(event.session_id);
        break;
      case "replay": {
        // 重连回放(§2.4):把历史事件投影成消息列表。
        // token 合并到同一条 assistant 消息;tool_start/tool_end 配对;sandbox_exec 记录。
        // 后端 get_history 返回 {seq,type,payload,actor};字段值在 payload 内,
        // 故取 p = payload(兼容直接扁平的事件结构)。
        const rebuilt: ChatMessage[] = [];
        let aiId: string | null = null;
        for (const ev of event.events) {
          const p = (ev as { payload?: Record<string, unknown> }).payload || ev;
          if (ev.type === "message_in") {
            rebuilt.push({ id: nextId(), from: "user", content: String((p as { content?: string }).content ?? ""), tools: [] });
            aiId = null;
          } else if (ev.type === "token") {
            if (!aiId) {
              aiId = nextId();
              rebuilt.push({ id: aiId, from: "assistant", content: "", tools: [] });
            }
            const idx = rebuilt.findIndex((m) => m.id === aiId);
            rebuilt[idx] = { ...rebuilt[idx], content: rebuilt[idx].content + String((p as { content?: string }).content ?? "") };
          } else if (ev.type === "reasoning") {
            if (!aiId) { aiId = nextId(); rebuilt.push({ id: aiId, from: "assistant", content: "", tools: [] }); }
            const idx = rebuilt.findIndex((m) => m.id === aiId);
            rebuilt[idx] = { ...rebuilt[idx], reasoning: (rebuilt[idx].reasoning || "") + String((p as { content?: string }).content ?? "") };
          } else if (ev.type === "todos") {
            if (!aiId) { aiId = nextId(); rebuilt.push({ id: aiId, from: "assistant", content: "", tools: [] }); }
            const td = p as { todos: TodoItem[] };
            const idx = rebuilt.findIndex((m) => m.id === aiId);
            rebuilt[idx] = { ...rebuilt[idx], todos: td.todos };
          } else if (ev.type === "context_compacted") {
            if (!aiId) { aiId = nextId(); rebuilt.push({ id: aiId, from: "assistant", content: "", tools: [] }); }
            const c = p as { summary: string; file_path?: string };
            const idx = rebuilt.findIndex((m) => m.id === aiId);
            rebuilt[idx] = { ...rebuilt[idx], compacted: { summary: c.summary, file_path: c.file_path } };
          } else if (ev.type === "tool_start") {
            if (!aiId) { aiId = nextId(); rebuilt.push({ id: aiId, from: "assistant", content: "", tools: [] }); }
            const t = p as { name: string; args?: Record<string, unknown>; is_subagent?: boolean; is_filesystem?: boolean };
            const idx = rebuilt.findIndex((m) => m.id === aiId);
            rebuilt[idx] = { ...rebuilt[idx], tools: [...rebuilt[idx].tools, { id: nextId(), name: t.name, args: t.args, status: "running", is_subagent: t.is_subagent, is_filesystem: t.is_filesystem }] };
          } else if (ev.type === "tool_end") {
            const t = p as { name: string; content: string };
            // 配对最近的同名 running 工具
            for (let i = rebuilt.length - 1; i >= 0; i--) {
              const m = rebuilt[i];
              const ti = [...m.tools].reverse().findIndex((x) => x.name === t.name && x.status === "running");
              if (ti >= 0) {
                const realIdx = m.tools.length - 1 - ti;
                m.tools[realIdx] = { ...m.tools[realIdx], status: "done", result: t.content };
                break;
              }
            }
          } else if (ev.type === "sandbox_exec") {
            if (!aiId) { aiId = nextId(); rebuilt.push({ id: aiId, from: "assistant", content: "", tools: [] }); }
            const s = p as { command: string; exit_code: number; stdout: string; duration_s: number };
            const idx = rebuilt.findIndex((m) => m.id === aiId);
            rebuilt[idx] = { ...rebuilt[idx], sandboxExecs: [...(rebuilt[idx].sandboxExecs || []), { command: s.command, exit_code: s.exit_code, stdout: s.stdout, duration_s: s.duration_s }] };
          }
        }
        setMessages(rebuilt);
        break;
      }
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
      case "reasoning": {
        // 推理过程累积(仅推理模型产生;与 token 同样追加到当前 AI 消息)
        setMessages((prev) => {
          let aiId = currentAiId.current;
          let next = prev;
          if (!aiId || !prev.find((m) => m.id === aiId)) {
            aiId = nextId();
            currentAiId.current = aiId;
            next = [...prev, { id: aiId, from: "assistant" as const, content: "", tools: [] }];
          }
          return next.map((m) =>
            m.id === aiId ? { ...m, reasoning: (m.reasoning || "") + event.content } : m
          );
        });
        break;
      }
      case "todos": {
        // 计划进度(deepagents write_todos 快照;最新覆盖)
        setMessages((prev) => {
          let aiId = currentAiId.current;
          let next = prev;
          if (!aiId || !prev.find((m) => m.id === aiId)) {
            aiId = nextId();
            currentAiId.current = aiId;
            next = [...prev, { id: aiId, from: "assistant" as const, content: "", tools: [] }];
          }
          return next.map((m) => (m.id === aiId ? { ...m, todos: event.todos } : m));
        });
        break;
      }
      case "context_compacted": {
        // 上下文压缩(deepagents SummarizationMiddleware 触发):标记当前 AI 消息
        setMessages((prev) => {
          let aiId = currentAiId.current;
          let next = prev;
          if (!aiId || !prev.find((m) => m.id === aiId)) {
            aiId = nextId();
            currentAiId.current = aiId;
            next = [...prev, { id: aiId, from: "assistant" as const, content: "", tools: [] }];
          }
          return next.map((m) =>
            m.id === aiId ? { ...m, compacted: { summary: event.summary, file_path: event.file_path } } : m
          );
        });
        break;
      }
      case "sandbox_exec": {
        // agent 在沙箱执行命令(§5.1):追加到当前 AI 消息
        setMessages((prev) => {
          let aiId = currentAiId.current;
          let next = prev;
          if (!aiId || !prev.find((m) => m.id === aiId)) {
            aiId = nextId();
            currentAiId.current = aiId;
            next = [...prev, { id: aiId, from: "assistant" as const, content: "", tools: [] }];
          }
          return next.map((m) => m.id === aiId ? {
            ...m, sandboxExecs: [...(m.sandboxExecs || []), { command: event.command, exit_code: event.exit_code, stdout: event.stdout, duration_s: event.duration_s }]
          } : m);
        });
        break;
      }
      case "control_ack":
        // §2: 控制消息回执(无 session 时 ok:false)。仅记录,不阻塞。
        break;
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
              ? { ...m, tools: [...m.tools, { id: tid, name: event.name, args: event.args, status: "running" as const, is_subagent: event.is_subagent, is_filesystem: event.is_filesystem }] }
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

  // 上行:发消息(可选带 agent_config_id,§8 对话选配置)
  const sendMessage = useCallback((text: string, agentConfigId?: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // 本地先加用户消息
    setMessages((prev) => [...prev, { id: nextId(), from: "user", content: text, tools: [] }]);
    currentAiId.current = null;
    ws.send(JSON.stringify({ message: text, agent_config_id: agentConfigId }));
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

  // 新对话:重置消息 + 重连 WS(不带 session_id → 首条消息建新会话)
  const newConversation = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    setSandboxUrl(null);
    setTakeoverActive(false);
    currentAiId.current = null;
    // 关旧连接重开新连接(无 session_id → 新会话)
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    connect();
  }, [connect]);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  return { messages, status, sessionId, sandboxUrl, takeoverActive, sendMessage, confirm, recover, takeover, cancel, setModel, setTools, setGuardMode, newConversation };
}
