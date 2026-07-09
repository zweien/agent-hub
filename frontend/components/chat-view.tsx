"use client";

import { useEffect, useState, useRef, useCallback } from "react";
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
  XIcon, HandIcon, PaperclipIcon, WrenchIcon, ShieldIcon, SquareIcon, TerminalIcon, PlusIcon, PanelRightIcon,
  CircleIcon, CircleDotIcon, CheckCircleIcon, FileIcon, ChevronDownIcon, UsersIcon,
} from "lucide-react";
import { useChatSocket, type ChatMessage, type SandboxExec, type TodoItem } from "@/hooks/use-chat-socket";
import { useAuth, API_BASE } from "@/contexts/auth-context";
import { useUI } from "@/contexts/ui-context";
import { ArtifactsPanel } from "@/components/artifacts-panel";

function buildWsUrl(token: string): string {
  if (typeof window === "undefined") return "ws://localhost:8000/ws/chat";
  return `ws://${window.location.hostname}:8000/ws/chat?token=${encodeURIComponent(token)}`;
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

function SandboxExecCard({ exec }: { exec: SandboxExec }) {
  return (
    <div className="my-1.5 rounded-lg border bg-zinc-950 p-2 text-xs text-zinc-200">
      <div className="mb-1 flex items-center gap-1.5 font-mono text-zinc-400">
        <TerminalIcon className="size-3" />
        <span className="truncate">$ {exec.command}</span>
        <span className={`ml-auto shrink-0 rounded px-1 ${exec.exit_code === 0 ? "bg-green-900/50 text-green-300" : "bg-red-900/50 text-red-300"}`}>
          exit {exec.exit_code} · {exec.duration_s}s
        </span>
      </div>
      {exec.stdout && <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-zinc-300">{exec.stdout.slice(0, 1500)}</pre>}
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
  const { artifactsCollapsed, toggleArtifacts } = useUI();
  const wsUrl = user ? buildWsUrl(user.token) : "";
  const { messages, status, sessionId, sandboxUrl, takeoverActive, sendMessage, confirm, recover, takeover, cancel, setModel, setTools, setGuardMode, newConversation } = useChatSocket(wsUrl);
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
  // urlTransform:给 markdown 里的 /api/sessions/... 图片 URL 注入 token(<img> 不带 header)
  const urlTransform = useCallback((url: string) => {
    if (url.startsWith("/api/sessions/") && user) {
      return `${url}?token=${encodeURIComponent(user.token)}`;
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
          <Button size="sm" variant="ghost" onClick={() => newConversation()}>
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
                {/* ① 推理过程(可折叠;仅推理模型产生) */}
                {msg.from === "assistant" && (msg.reasoning || status === "streaming") && (
                  <Reasoning content={msg.reasoning || ""} isStreaming={!!msg.reasoning && status === "streaming" && !msg.content} />
                )}
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
