"use client";

import { useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
  ArrowUpIcon, ExternalLinkIcon, RefreshCwIcon, SkipForwardIcon,
  XIcon, HandIcon, PaperclipIcon, WrenchIcon, ShieldIcon, SquareIcon,
} from "lucide-react";
import { useChatSocket, type ChatMessage } from "@/hooks/use-chat-socket";

const WS_URL = typeof window !== "undefined"
  ? `ws://${window.location.hostname}:8000/ws/chat`
  : "ws://localhost:8000/ws/chat";

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

export function ChatView() {
  const { messages, status, sandboxUrl, takeoverActive, sendMessage, confirm, recover, takeover, cancel, setModel, setTools, setGuardMode } = useChatSocket(WS_URL);
  const [input, setInput] = useState("");
  const [model, setLocalModel] = useState("deepseek-v4-flash");
  const [selectedTools, setSelectedTools] = useState<string[]>(["run_aero_tool", "run_sweep_in_sandbox"]);
  const [mode, setLocalMode] = useState("standard");

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    sendMessage(text);
    setInput("");
  };

  return (
    <div className="flex h-full flex-col">
      {/* 接管/工作环境入口 */}
      {sandboxUrl && takeoverActive && (
        <a href={sandboxUrl} target="_blank" rel="noreferrer"
           className="flex items-center gap-2 bg-primary/10 px-4 py-2 text-sm text-primary hover:bg-primary/20">
          <ExternalLinkIcon className="size-4" /> 已进入接管模式,点此打开工作环境(VSCode/终端)
        </a>
      )}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Button size="sm" variant="ghost" onClick={() => takeover(!takeoverActive)}>
          <HandIcon className="size-3.5" /> {takeoverActive ? "交还(恢复Agent)" : "接管"}
        </Button>
      </div>

      {/* 消息区 */}
      <Conversation className="flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl px-4">
          {messages.length === 0 && (
            <ConversationEmptyState className="pt-20 text-center text-muted-foreground">
              机翼气动优化助手 · 输入需求开始对话
            </ConversationEmptyState>
          )}
          {messages.map((msg) => (
            <Message key={msg.id} from={msg.from}>
              <MessageContent>
                {msg.tools.map((t) => <ToolCard key={t.id} tool={t} />)}
                <ConfirmBar msg={msg} onConfirm={confirm} />
                <RecoveryBar msg={msg} onRecover={recover} />
                {msg.content && <MessageResponse className="prose-chat">{msg.content}</MessageResponse>}
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
                  {["run_aero_tool", "run_sweep_in_sandbox"].map((t) => (
                    <DropdownMenuCheckboxItem
                      key={t}
                      checked={selectedTools.includes(t)}
                      onCheckedChange={(chk) => {
                        const next = chk ? [...selectedTools, t] : selectedTools.filter((x) => x !== t);
                        setSelectedTools(next); setTools(next);
                      }}
                    >
                      {t === "run_aero_tool" ? "气动分析" : "展弦比扫描"}
                    </DropdownMenuCheckboxItem>
                  ))}
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
    </div>
  );
}
