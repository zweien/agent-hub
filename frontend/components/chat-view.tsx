"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Reasoning } from "@/components/ai-elements/reasoning";
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import {
  Collapsible, CollapsibleTrigger, CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
  ArrowUpIcon, ExternalLinkIcon, RefreshCwIcon, SkipForwardIcon,
  XIcon, HandIcon, PaperclipIcon, WrenchIcon, ShieldIcon, SquareIcon, TerminalIcon, PlusIcon, PanelRightIcon, PanelLeftIcon,
  CircleIcon, CircleDotIcon, CheckCircleIcon, FileIcon, ChevronDownIcon, UsersIcon,
  Loader2Icon,
} from "lucide-react";
import { useChatSocket, type ChatMessage, type SandboxExec, type TodoItem } from "@/hooks/use-chat-socket";
import { useAuth, API_BASE } from "@/contexts/auth-context";
import { useUI } from "@/contexts/ui-context";
import { ArtifactsPanel } from "@/components/artifacts-panel";

function buildWsUrl(token: string, sessionId?: string | null): string {
  if (typeof window === "undefined") return "ws://localhost:8000/ws/chat";
  let url = `ws://${window.location.hostname}:8000/ws/chat?token=${encodeURIComponent(token)}`;
  // 带 session_id 连接 → 后端回放历史 + 订阅实时流(会话恢复 §2.4)
  if (sessionId) url += `&session_id=${encodeURIComponent(sessionId)}`;
  return url;
}

// 相对时间(会话列表用):"3分钟前"/"2小时前"/"昨天"/"7/9"
function fmtRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min}分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}小时前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "昨天";
  if (day < 7) return `${day}天前`;
  return new Date(iso).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

interface AgentConfigBrief { id: string; name: string; model: string; mode: string; tools: string[] }
interface ToolBrief { id: string; name: string; description: string; type: string }

function ToolCard({ tool }: { tool: ChatMessage["tools"][number] }) {
  return (
    <Tool>
      <ToolHeader type={`tool-${tool.name}`} state={tool.status === "running" ? "input-available" : "output-available"} />
      <ToolContent>
        <ToolInput input={tool.args ?? {}} />
        {tool.result && <ToolOutput output={tool.result} errorText={undefined} />}
      </ToolContent>
    </Tool>
  );
}

function TodoPanel({ todos }: { todos: TodoItem[] }) {
  if (!todos || todos.length === 0) return null;
  const done = todos.filter((t) => t.status === "completed").length;
  return (
    <div className="my-1.5 w-full rounded-lg border bg-muted/30 p-2.5 text-xs">
      <div className="mb-1.5 flex items-center gap-1.5 font-medium text-foreground">
        <span>📋 计划进度</span>
        <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
          {done}/{todos.length}
        </span>
      </div>
      <ul className="space-y-1">
        {todos.map((t, i) => (
          <li key={i} className="flex items-start gap-1.5">
            {t.status === "completed" ? (
              <CheckCircleIcon className="mt-0.5 size-3.5 shrink-0 text-green-600" />
            ) : t.status === "in_progress" ? (
              <CircleDotIcon className="mt-0.5 size-3.5 shrink-0 animate-pulse text-blue-600" />
            ) : (
              <CircleIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className={t.status === "completed" ? "text-muted-foreground line-through" : "text-foreground"}>
              {t.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StreamingTodoBar({ todos }: { todos: TodoItem[] }) {
  // streaming 时顶部常驻进度条:折叠一行(进度条 + 当前 in_progress 项),点击展开全部。
  // 与消息流里的 TodoPanel 互补:streaming 时活,done 后消失(消息流保留快照)。
  const [expanded, setExpanded] = useState(false);
  if (!todos || todos.length === 0) return null;
  const done = todos.filter((t) => t.status === "completed").length;
  const total = todos.length;
  const pct = total > 0 ? (done / total) * 100 : 0;
  const current = todos.find((t) => t.status === "in_progress");
  const currentText = current?.content?.trim() || "处理中…";
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-1">
      <div className="rounded-lg border bg-muted/30 text-xs">
        {/* 折叠行:进度条 + 当前项 + 展开按钮 */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/40"
        >
          <span className="shrink-0 tabular-nums text-muted-foreground">{done}/{total}</span>
          {/* 自绘线性进度条:底 + 填充 */}
          <span className="relative h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-muted">
            <span className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
          </span>
          <Loader2Icon className="size-3.5 shrink-0 animate-spin text-primary" />
          <span className="min-w-0 flex-1 truncate text-foreground">{currentText}</span>
          <ChevronDownIcon className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
        {/* 展开态:完整 todo 列表(复用 TodoPanel 的图标/样式) */}
        {expanded && (
          <ul className="space-y-1 border-t px-3 py-2">
            {todos.map((t, i) => (
              <li key={i} className="flex items-start gap-1.5">
                {t.status === "completed" ? (
                  <CheckCircleIcon className="mt-0.5 size-3.5 shrink-0 text-green-600" />
                ) : t.status === "in_progress" ? (
                  <CircleDotIcon className="mt-0.5 size-3.5 shrink-0 animate-pulse text-blue-600" />
                ) : (
                  <CircleIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className={t.status === "completed" ? "text-muted-foreground line-through" : "text-foreground"}>
                  {t.content}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SubagentCard({ tool }: { tool: ChatMessage["tools"][number] }) {
  // deepagents 的 task 工具:args 含 description / subagent_type
  const desc = (tool.args as { description?: string })?.description || "";
  const saType = (tool.args as { subagent_type?: string })?.subagent_type || "子代理";
  return (
    <div className="my-1.5 w-full rounded-lg border border-violet-200 bg-violet-50/50 p-2.5 text-xs">
      <div className="mb-1 flex items-center gap-1.5 font-medium text-violet-700">
        <UsersIcon className="size-3.5 shrink-0" />
        <span>子代理 · {saType}</span>
        {tool.status === "running" && (
          <span className="ml-auto text-violet-500">委派执行中…</span>
        )}
      </div>
      {desc && <div className="mb-1 text-foreground">{desc}</div>}
      {tool.result && (
        <div className="mt-1.5 max-h-40 overflow-auto rounded bg-white/60 p-1.5 font-mono text-muted-foreground">
          {tool.result.slice(0, 800)}
        </div>
      )}
    </div>
  );
}

function FileSystemToolGroup({ tools }: { tools: ChatMessage["tools"] }) {
  // 把 is_filesystem 的工具折叠成"文件操作"组
  const fsTools = tools.filter((t) => t.is_filesystem);
  if (fsTools.length === 0) return null;
  return (
    <Collapsible className="my-1.5 w-full rounded-lg border bg-muted/20 text-xs">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-2.5 py-1.5 hover:bg-muted/40">
        <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium text-foreground">文件操作</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{fsTools.length}</span>
        <ChevronDownIcon className="ml-auto size-3.5 text-muted-foreground" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-1 border-t p-2">
          {fsTools.map((t, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span className="font-mono text-purple-600">{t.name}</span>
              {t.status === "running" && <span className="text-muted-foreground">…</span>}
              {t.result && (
                <span className="truncate text-muted-foreground">→ {t.result.slice(0, 60)}</span>
              )}
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function TypingIndicator() {
  // ChatGPT 风格三点跳动:streaming 且尚无 content 时,在 AI 消息位置显示,
  // 让用户明确感知后台在运行(尤其 reasoning 阶段 2-4 分钟无文本)。
  // 用 animate-pulse(Tailwind 默认带,已验证可用)+ 错开 delay 模拟跳动。
  return (
    <div className="flex items-center gap-1 py-2" aria-label="正在思考">
      <span className="size-2 animate-pulse rounded-full bg-foreground/50 [animation-delay:-0.3s]" />
      <span className="size-2 animate-pulse rounded-full bg-foreground/50 [animation-delay:-0.15s]" />
      <span className="size-2 animate-pulse rounded-full bg-foreground/50" />
    </div>
  );
}

function SandboxExecCard({ exec }: { exec: SandboxExec }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1.5 rounded-lg border bg-zinc-950 text-xs text-zinc-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left font-mono text-zinc-400 hover:bg-zinc-900/60"
      >
        <TerminalIcon className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate">$ {exec.command}</span>
        <span className={`shrink-0 rounded px-1 ${exec.exit_code === 0 ? "bg-green-900/50 text-green-300" : "bg-red-900/50 text-red-300"}`}>
          exit {exec.exit_code} · {exec.duration_s}s
        </span>
        <ChevronDownIcon className={`size-3 shrink-0 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && exec.stdout && <pre className="max-h-40 overflow-auto whitespace-pre-wrap border-t border-zinc-800 px-2 py-1.5 font-mono text-zinc-300">{exec.stdout.slice(0, 1500)}</pre>}
    </div>
  );
}

function ConfirmBar({ msg, onConfirm }: { msg: ChatMessage; onConfirm: (id: string, approved: boolean) => void }) {
  if (!msg.pendingConfirm) return null;
  const { action_id, tool, args } = msg.pendingConfirm;
  return (
    <div className="my-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
      <div className="mb-2 font-medium">⚠️ 即将执行 <code className="rounded bg-amber-100 px-1">{tool}</code>,请确认:</div>
      <pre className="mb-2 max-h-40 overflow-auto rounded bg-white/60 p-2 text-xs">{JSON.stringify(args, null, 2)}</pre>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onConfirm(action_id, true)}>
          <ArrowUpIcon className="size-3.5" /> 批准执行
        </Button>
        <Button size="sm" variant="outline" onClick={() => onConfirm(action_id, false)}>
          <XIcon className="size-3.5" /> 拒绝
        </Button>
      </div>
    </div>
  );
}

function RecoveryBar({ msg, onRecover }: { msg: ChatMessage; onRecover: (a: string) => void }) {
  if (!msg.interrupted) return null;
  return (
    <div className="my-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm">
      <div className="mb-2 font-medium">⛔ 执行中断</div>
      <div className="mb-2 text-muted-foreground text-xs">{msg.interrupted.reason}</div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => onRecover("retry")}><RefreshCwIcon className="size-3.5" /> 重试</Button>
        <Button size="sm" variant="outline" onClick={() => onRecover("skip")}><SkipForwardIcon className="size-3.5" /> 跳过</Button>
        <Button size="sm" variant="outline" onClick={() => onRecover("end")}><XIcon className="size-3.5" /> 结束</Button>
      </div>
    </div>
  );
}

function NoticeBar({ msg }: { msg: ChatMessage }) {
  // 轻量系统提示(如:并发拒绝)。不改会话状态,仅提示。
  if (!msg.notice) return null;
  return (
    <div className="my-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      {msg.notice}
    </div>
  );
}

function CompactedBar({ msg }: { msg: ChatMessage }) {
  // deepagents SummarizationMiddleware 触发:上下文已压缩为摘要
  if (!msg.compacted) return null;
  return (
    <Collapsible className="my-1.5 w-full rounded-lg border border-blue-200 bg-blue-50/40 text-xs">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-2.5 py-1.5 hover:bg-blue-50/60">
        <FileIcon className="size-3.5 shrink-0 text-blue-600" />
        <span className="font-medium text-blue-700">⏺ 上下文已压缩</span>
        <span className="text-muted-foreground">历史对话已摘要,节省 token</span>
        <ChevronDownIcon className="ml-auto size-3.5 text-muted-foreground" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-blue-100 px-2.5 py-2 text-muted-foreground">
          {msg.compacted.summary && (
            <p className="mb-1.5 whitespace-pre-wrap break-words leading-relaxed text-foreground">
              {msg.compacted.summary}
            </p>
          )}
          {msg.compacted.file_path && (
            <p className="font-mono text-[11px] text-muted-foreground">
              完整历史已落盘:{msg.compacted.file_path}(可用 read_file 恢复)
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ChatView() {
  const { user } = useAuth();
  const { artifactsCollapsed, toggleArtifacts, conversationsCollapsed, toggleConversations } = useUI();
  const router = useRouter();
  const searchParams = useSearchParams();
  // 会话恢复(§2.4):URL ?session=xxx 携带要恢复的会话 id。
  // 关键:WS URL 只用"建立连接时的初始 session"快照,连接生命周期内不变,
  // 否则 session_started 同步 URL → wsUrl 变 → WS 重连 → 打断正在进行的流式
  // 回复(用户表现为"发送后没反应")。新会话由后端在首条消息时于同一连接内创建。
  // newConversation 显式重置此 ref(配合 router.replace('/chat'))。
  const initialSessionRef = useRef<string | null>(searchParams.get("session"));
  const wsUrl = user ? buildWsUrl(user.token, initialSessionRef.current) : "";
  const { messages, status, sessionId, sandboxUrl, takeoverActive, sendMessage, confirm, recover, takeover, cancel, setModel, setTools, setGuardMode, newConversation, switchSession } = useChatSocket(wsUrl, initialSessionRef.current);
  const [input, setInput] = useState("");
  const [model, setLocalModel] = useState("deepseek-v4-flash");
  const [selectedTools, setSelectedTools] = useState<string[]>(["run_aero_tool", "run_sweep_in_sandbox"]);
  const [mode, setLocalMode] = useState("standard");
  // artifacts 刷新触发器:status 从 streaming→ready 时递增,提示面板拉新产物
  const [artifactRefresh, setArtifactRefresh] = useState(0);
  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === "streaming" && status === "ready") {
      setArtifactRefresh((k) => k + 1); // agent 完成一轮,可能产了新文件
    }
    prevStatus.current = status;
  }, [status]);
  // 沙箱状态徽章:轮询 GET /sessions/{id}/sandbox,显示"沙箱活跃/已回收"。
  // 仅有 sessionId 时轮询(会话已建立);每 15s 一次,足够反映空闲回收。
  const [sandboxActive, setSandboxActive] = useState(false);
  const [sandboxHref, setSandboxHref] = useState<string | null>(null);
  useEffect(() => {
    if (!user || !sessionId) { setSandboxActive(false); setSandboxHref(null); return; }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/sessions/${sessionId}/sandbox`, { headers: { Authorization: `Bearer ${user.token}` } });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setSandboxActive(!!data.active);
        setSandboxHref(data.url || null);
      } catch { /* 忽略瞬时错误 */ }
    };
    poll(); // 立即查一次
    const t = setInterval(poll, 15000);
    return () => { cancelled = true; clearInterval(t); };
  }, [user, sessionId]);
  // 会话恢复-URL 同步:新会话首条消息后(session_started→sessionId 变化),
  // 把 ?session=xxx 补进 URL,使刷新/复制链接可恢复。replace 不入历史栈。
  // 注意:此处不动 initialSessionRef(WS URL 必须稳定),仅做 URL 美化。
  useEffect(() => {
    if (sessionId && sessionId !== searchParams.get("session")) {
      router.replace(`/chat?session=${sessionId}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
  // 会话列表(对话页左面板):GET /sessions,进入 + 会话变化(sessionId/status)时拉。
  // 不轮询;新会话/状态变化后即时反映。复用 dashboard 的 SessionBrief + STATUS_META。
  interface SessionBrief { id: string; status: string; title: string | null; created_at: string | null }
  const SESSION_STATUS_META: Record<string, { label: string; color: string }> = {
    done: { label: "已完成", color: "#22c55e" }, running: { label: "运行中", color: "#3b82f6" },
    interrupted: { label: "已中断", color: "#f59e0b" }, awaiting_user: { label: "待确认", color: "#a855f7" },
    human_takeover: { label: "人工接管", color: "#ec4899" }, idle: { label: "空闲", color: "#94a3b8" },
  };
  const [conversations, setConversations] = useState<SessionBrief[]>([]);
  useEffect(() => {
    if (!user) return;
    fetch(`${API_BASE}/sessions`, { headers: { Authorization: `Bearer ${user.token}` } })
      .then(r => r.ok ? r.json() : [])
      .then(setConversations)
      .catch(() => {});
  }, [user, sessionId, status]);
  // urlTransform:把 markdown 里的 /api/sessions/... 图片 URL 改写成后端绝对 URL + token
  // (<img> 不带 Authorization header,需走 ?token= 双模式鉴权)。
  // 后端实际路径是 /sessions/{id}/artifacts/...(无 /api 前缀),且跨端口(8000),
  // 故拼成 API_BASE 绝对地址,否则相对路径打到 Next(3000)会 404。
  const urlTransform = useCallback((url: string) => {
    if (url.startsWith("/api/sessions/") && user) {
      const path = url.slice("/api".length);  // /api/sessions/... → /sessions/...
      return `${API_BASE}${path}?token=${encodeURIComponent(user.token)}`;
    }
    return url;
  }, [user]);
  // §8 对话选配置(§1 闭环核心:A 配置 → B 使用)
  const [configs, setConfigs] = useState<AgentConfigBrief[]>([]);
  const [agentConfigId, setAgentConfigId] = useState<string>("");
  // 可用工具列表(动态拉取,替代硬编码)
  const [availTools, setAvailTools] = useState<ToolBrief[]>([]);

  // 拉取已发布 agent 配置 + 工具列表
  useEffect(() => {
    if (!user) return;
    fetch(`${API_BASE}/agents`, { headers: { Authorization: `Bearer ${user.token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((list: AgentConfigBrief[]) => setConfigs(list))
      .catch(() => setConfigs([]));
    fetch(`${API_BASE}/tools`, { headers: { Authorization: `Bearer ${user.token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((list: ToolBrief[]) => setAvailTools(list))
      .catch(() => setAvailTools([]));
  }, [user]);

  // 选了配置后,把它声明的 model/tools/mode 同步到会话(给 agent 用统一基线)
  const applyConfig = (cfgId: string) => {
    setAgentConfigId(cfgId);
    const cfg = configs.find((c) => c.id === cfgId);
    if (cfg) {
      setLocalModel(cfg.model);
      setLocalMode(cfg.mode);
      setSelectedTools(cfg.tools);
      setModel(cfg.model);
      setGuardMode(cfg.mode);
      setTools(cfg.tools);
    }
  };

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    sendMessage(text, agentConfigId || undefined);
    setInput("");
  };

  return (
    <div className="flex h-full">
      {/* 会话列表左面板(可折叠:展开 w-64 / 折叠 w-12 rail) */}
      <aside className={`flex shrink-0 flex-col border-r bg-muted/30 transition-[width] duration-200 ${conversationsCollapsed ? "w-12" : "w-64"}`}>
        {/* 顶部:新建 / 展开-折叠 */}
        <div className={`flex items-center gap-1 border-b p-2 ${conversationsCollapsed ? "flex-col" : "justify-between"}`}>
          {conversationsCollapsed ? (
            <>
              <Button size="icon-sm" variant="ghost" title="新对话" onClick={() => { newConversation(); initialSessionRef.current = null; router.replace("/chat"); }}>
                <PlusIcon className="size-4" />
              </Button>
              <Button size="icon-sm" variant="ghost" title="展开会话列表" onClick={toggleConversations}>
                <PanelLeftIcon className="size-4" />
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" className="w-full" onClick={() => { newConversation(); initialSessionRef.current = null; router.replace("/chat"); }}>
                <PlusIcon className="size-3.5" /> 新对话
              </Button>
              <Button size="icon-sm" variant="ghost" title="折叠会话列表" onClick={toggleConversations}>
                <PanelLeftIcon className="size-4" />
              </Button>
            </>
          )}
        </div>
        {/* 列表(折叠态隐藏) */}
        {!conversationsCollapsed && (
          <div className="flex-1 overflow-y-auto p-1.5">
            {conversations.length === 0 && (
              <div className="px-2 py-4 text-center text-xs text-muted-foreground">暂无会话</div>
            )}
            {conversations.map(s => {
              const meta = SESSION_STATUS_META[s.status] || { label: s.status, color: "#94a3b8" };
              const active = s.id === sessionId;
              return (
                <button
                  key={s.id}
                  onClick={() => { initialSessionRef.current = s.id; switchSession(s.id); router.replace(`/chat?session=${s.id}`); }}
                  className={`mb-0.5 flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors ${active ? "bg-accent" : "hover:bg-accent/50"}`}
                >
                  <div className="flex w-full items-center gap-1.5">
                    <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} title={meta.label} />
                    <span className={`flex-1 truncate text-xs ${active ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                      {s.title || "(无标题)"}
                    </span>
                  </div>
                  {s.created_at && (
                    <span className="pl-3 text-[10px] text-muted-foreground/70">{fmtRelative(s.created_at)}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </aside>
      <div className="flex flex-1 flex-col min-w-0">
      {/* 接管/工作环境入口 */}
      {sandboxUrl && takeoverActive && (
        <Button
          variant="ghost"
          className="h-auto justify-start rounded-none bg-primary/10 px-4 py-2 text-sm text-primary hover:bg-primary/20"
          onClick={() => window.open(sandboxUrl, "_blank", "noopener,noreferrer")}
        >
          <ExternalLinkIcon className="size-4" /> 已进入接管模式,点此打开工作环境(VSCode/终端)
        </Button>
      )}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => takeover(!takeoverActive)} disabled={!takeoverActive && status !== "streaming"}>
            <HandIcon className="size-3.5" /> {takeoverActive ? "交还(恢复Agent)" : "接管"}
          </Button>
          {status === "error" && (
            <span className="rounded bg-red-50 px-2 py-0.5 text-xs text-red-600">连接断开,正在重连...</span>
          )}
          {sessionId && (
            <span className="text-xs text-muted-foreground">{sessionId.slice(0, 12)}...</span>
          )}
          {sessionId && (
            sandboxActive
              ? <span className="flex items-center gap-1 rounded bg-green-50 px-1.5 py-0.5 text-xs text-green-600" title="会话沙箱容器运行中">
                  <span className="size-1.5 rounded-full bg-green-500" /> 沙箱活跃
                  {sandboxHref && (
                    <a href={sandboxHref} target="_blank" rel="noopener noreferrer" className="ml-0.5 underline hover:text-green-700">打开</a>
                  )}
                </span>
              : <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground" title="沙箱已回收或未创建,发条消息可重启">
                  <span className="size-1.5 rounded-full bg-muted-foreground/50" /> 沙箱已回收
                </span>
          )}
        </div>
        {/* 新对话:仅非流式且已有消息时显示 */}
        {status !== "streaming" && messages.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => { newConversation(); initialSessionRef.current = null; router.replace("/chat"); }}>
            <PlusIcon className="size-3.5" /> 新对话
          </Button>
        )}
      </div>

      {/* 消息区 */}
      <Conversation className="flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl px-4">
          {messages.length === 0 && (
            <ConversationEmptyState className="pt-20 text-center text-muted-foreground">
              输入需求开始对话
            </ConversationEmptyState>
          )}
          {messages.map((msg) => (
            <Message key={msg.id} from={msg.from}>
              <MessageContent>
                {/* ⓪ 思考反馈(ChatGPT 风格三点跳动):streaming 且尚无文本回复时显示,
                    让用户明确感知后台在运行(尤其 reasoning 阶段长等待)。有 content 后消失。 */}
                {msg.from === "assistant" && status === "streaming" && !msg.content && <TypingIndicator />}
                {/* ① 推理过程(可折叠;仅推理模型产生)。
                    streaming 时即使无 reasoning 文本(langchain 可能丢弃 DeepSeek 的
                    delta.reasoning 字段)也显示"思考中…"指示,避免用户长等待无反馈。 */}
                {msg.from === "assistant" && (msg.reasoning || status === "streaming") && (
                  <Reasoning content={msg.reasoning || ""} isStreaming={status === "streaming" && !msg.content} />
                )}
                {/* 轻量系统提示(并发拒绝等) */}
                <NoticeBar msg={msg} />
                {/* 上下文压缩提示(deepagents SummarizationMiddleware 触发) */}
                <CompactedBar msg={msg} />
                {/* ② 计划进度(deepagents write_todos) */}
                {msg.todos && msg.todos.length > 0 && <TodoPanel todos={msg.todos} />}
                {/* ③ 子代理委派(deepagents task 工具,独立卡片) */}
                {msg.tools.filter((t) => t.is_subagent).map((t) => <SubagentCard key={t.id} tool={t} />)}
                {/* ④ 文件操作(deepagents FilesystemMiddleware,折叠组) */}
                <FileSystemToolGroup tools={msg.tools} />
                {/* ⑤ 普通业务工具(run_aero 等) */}
                {msg.tools.filter((t) => !t.is_subagent && !t.is_filesystem).map((t) => <ToolCard key={t.id} tool={t} />)}
                {/* ⑥ 沙箱命令执行 */}
                {msg.sandboxExecs?.map((ex, i) => <SandboxExecCard key={`sx${i}`} exec={ex} />)}
                <ConfirmBar msg={msg} onConfirm={confirm} />
                <RecoveryBar msg={msg} onRecover={recover} />
                {/* ⑦ 最终文本回复 */}
                {msg.content && <MessageResponse className="prose-chat" urlTransform={urlTransform}>{msg.content}</MessageResponse>}
              </MessageContent>
            </Message>
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* 常驻计划进度条:取最后一条 AI 消息的 todos。streaming/connecting(WS 断连重连)
          时显示,ready/error(完成/出错)时消失;消息流里仍保留 TodoPanel 快照。
          看消息不看连接态,避免 WS 重连瞬间进度条闪烁消失。 */}
      {status !== "ready" && status !== "error" && (() => {
        const liveMsg = [...messages].reverse().find((m) => m.from === "assistant");
        const liveTodos = liveMsg?.todos;
        return liveTodos && liveTodos.length > 0 ? <StreamingTodoBar todos={liveTodos} /> : null;
      })()}

      {/* 输入区(ChatGPT 风格:圆角胶囊 + 工具栏)— 用原生 form 自建,绕开 PromptInput 的 InputGroup 约束 */}
      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          className="flex flex-col rounded-2xl border bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring"
        >
          {/* 文字输入区(上方,充足空间) */}
          <textarea
            className="min-h-24 max-h-52 w-full resize-none rounded-none border-0 bg-transparent px-4 pt-3 text-base outline-none placeholder:text-muted-foreground focus:ring-0"
            placeholder="发送消息(如:算翼展10米、面积10平米的升阻比)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          />
          {/* 工具栏(下方独立行):左侧控件,右侧发送/停止 */}
          <div className="flex items-center justify-between border-t border-border px-2 py-1.5">
            <div className="flex items-center gap-1">
              {/* 附件 */}
              <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground"
                      onClick={() => alert("附件功能:V1 本地预览,后端解析留 V2")}>
                <PaperclipIcon className="size-4" />
              </Button>
              {/* Agent 配置选择(§1 闭环:对话用哪个已发布配置) */}
              <Select value={agentConfigId} onValueChange={applyConfig}>
                <SelectTrigger className="h-8 w-[130px] gap-1 border-0 bg-muted/60 text-xs">
                  <SelectValue placeholder="默认助手" />
                </SelectTrigger>
                <SelectContent>
                  {configs.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* 模型选择 */}
              <Select value={model} onValueChange={(v) => { setLocalModel(v); setModel(v); }}>
                <SelectTrigger className="h-8 w-[150px] gap-1 border-0 bg-muted/60 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="deepseek-v4-flash">DeepSeek V4 Flash</SelectItem>
                  <SelectItem value="MiniMax-M-2.7">MiniMax M 2.7</SelectItem>
                </SelectContent>
              </Select>
              {/* 工具选择 */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 text-xs text-muted-foreground">
                    <WrenchIcon className="size-3.5" /> 工具({selectedTools.length})
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {availTools.map((t) => {
                    const ref = t.id.startsWith("tool_") ? t.id : t.name;
                    return (
                      <DropdownMenuCheckboxItem
                        key={t.id}
                        checked={selectedTools.includes(ref)}
                        onCheckedChange={(chk) => {
                          const next = chk ? [...selectedTools, ref] : selectedTools.filter((x) => x !== ref);
                          setSelectedTools(next); setTools(next);
                        }}
                      >
                        {t.name} {t.type !== "builtin" && `(${t.type})`}
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
              {/* 防护模式 */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 text-xs text-muted-foreground">
                    <ShieldIcon className="size-3.5" /> {mode === "yolo" ? "YOLO" : mode === "strict" ? "严谨" : "标准"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {([["strict", "严谨(强制确认)"], ["standard", "标准(首次确认)"], ["yolo", "YOLO(不确认)"]] as const).map(([v, label]) => (
                    <DropdownMenuItem key={v} onClick={() => { setLocalMode(v); setGuardMode(v); }}>
                      {label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {/* 发送 / 停止 */}
            {status === "streaming" ? (
              <Button type="button" size="icon-sm" variant="outline" onClick={() => cancel()}>
                <SquareIcon className="size-4" />
              </Button>
            ) : (
              <Button type="submit" size="icon-sm" disabled={!input.trim()}>
                <ArrowUpIcon className="size-4" />
              </Button>
            )}
          </div>
        </form>
        <div className="mt-1 text-center text-xs text-muted-foreground">Agent Hub · 按 Enter 发送,Shift+Enter 换行</div>
      </div>
      </div> {/* 关闭聊天列 */}
      {/* 右侧产物面板(artifacts):可折叠 */}
      {user && artifactsCollapsed && (
        <aside className="flex w-12 shrink-0 flex-col items-center border-l bg-background py-2">
          <Button size="icon-sm" variant="ghost" onClick={toggleArtifacts} title="展开产物面板">
            <PanelRightIcon className="size-4" />
          </Button>
        </aside>
      )}
      {user && !artifactsCollapsed && (
        <ArtifactsPanel
          sessionId={sessionId}
          token={user.token}
          refreshKey={artifactRefresh}
          onCollapse={toggleArtifacts}
        />
      )}
    </div>
  );
}
