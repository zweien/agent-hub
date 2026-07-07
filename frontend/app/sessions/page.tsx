"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, API_BASE } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon, ChevronRightIcon } from "lucide-react";

// —— 类型(与后端 events 投影对应)——
interface SessionBrief {
  id: string; status: string; title: string | null;
  agent_config_id: string | null; created_at: string | null;
}
interface EventItem {
  seq: number; type: string; payload: any; actor: string | null; created_at: string | null;
}
interface SessionEvents {
  session_id: string; title: string | null; status: string; events: EventItem[];
}

// 事件类型 → 中文标签 + 颜色
const TYPE_META: Record<string, { label: string; cls: string }> = {
  message_in: { label: "用户消息", cls: "bg-blue-100 text-blue-700" },
  message_out: { label: "Agent回复", cls: "bg-violet-100 text-violet-700" },
  token: { label: "token", cls: "bg-gray-100 text-gray-500" },
  tool_start: { label: "工具调用", cls: "bg-amber-100 text-amber-700" },
  tool_end: { label: "工具结果", cls: "bg-amber-50 text-amber-600" },
  sandbox_exec: { label: "沙箱执行", cls: "bg-zinc-800 text-zinc-100" },
  llm_call: { label: "LLM调用", cls: "bg-teal-100 text-teal-700" },
  action_required: { label: "待确认", cls: "bg-orange-100 text-orange-700" },
  action_resolved: { label: "确认结果", cls: "bg-orange-50 text-orange-600" },
  takeover_begin: { label: "接管开始", cls: "bg-fuchsia-100 text-fuchsia-700" },
  takeover_end: { label: "接管结束", cls: "bg-fuchsia-50 text-fuchsia-600" },
  mode_changed: { label: "模式切换", cls: "bg-cyan-100 text-cyan-700" },
  model_changed: { label: "模型切换", cls: "bg-cyan-50 text-cyan-600" },
  interrupted: { label: "中断", cls: "bg-red-100 text-red-700" },
  done: { label: "完成", cls: "bg-green-100 text-green-700" },
  error: { label: "错误", cls: "bg-red-100 text-red-700" },
};

function payloadSummary(type: string, payload: any): string {
  switch (type) {
    case "message_in": return payload.content?.slice(0, 80) || "";
    case "token": return "";
    case "tool_start": return `${payload.name}(${JSON.stringify(payload.args || {}).slice(0, 60)})`;
    case "tool_end": return `${payload.name}: ${String(payload.content || "").slice(0, 80)}`;
    case "sandbox_exec": return `$ ${payload.command?.slice(0, 60)}  [exit ${payload.exit_code}]`;
    case "action_required": return `${payload.tool} ${JSON.stringify(payload.args || {}).slice(0, 60)}`;
    case "action_resolved": return payload.approved ? "✓ 批准" : "✗ 拒绝";
    case "mode_changed": return `→ ${payload.mode}`;
    case "model_changed": return `→ ${payload.model}`;
    case "interrupted": return payload.reason?.slice(0, 100) || "";
    case "recover": return payload.action;
    default: return "";
  }
}

export default function SessionsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionBrief[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionEvents | null>(null);
  const [hideTokens, setHideTokens] = useState(true);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  const fetchSessions = async () => {
    if (!user) return;
    const res = await fetch(`${API_BASE}/sessions`, { headers: { Authorization: `Bearer ${user.token}` } });
    if (res.ok) setSessions(await res.json());
  };
  useEffect(() => { fetchSessions(); }, [user]);

  const openSession = async (id: string) => {
    if (!user) return;
    setActiveId(id);
    const res = await fetch(`${API_BASE}/sessions/${id}/events`, { headers: { Authorization: `Bearer ${user.token}` } });
    if (res.ok) setDetail(await res.json());
    else setDetail(null);
  };

  if (loading || !user) return <div className="flex h-screen items-center justify-center text-muted-foreground">加载中...</div>;

  const shownEvents = detail?.events.filter((e) => !hideTokens || e.type !== "token") || [];

  return (
    <AppShell>
        <div className="mx-auto max-w-4xl p-6">
          <div className="mb-6 flex items-center gap-3">
            <Button variant="ghost" size="icon-sm" onClick={() => { setActiveId(null); setDetail(null); }}>
              <ArrowLeftIcon className="size-4" />
            </Button>
            <h1 className="text-xl font-semibold">会话回放(§5.1 事件流)</h1>
          </div>

          {!activeId ? (
            /* 会话列表 */
            <div className="space-y-2">
              {sessions.length === 0 && <div className="text-sm text-muted-foreground">暂无会话</div>}
              {sessions.map((s) => (
                <button key={s.id} onClick={() => openSession(s.id)}
                  className="flex w-full items-center justify-between rounded-lg border p-3 text-left hover:bg-accent">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{s.title || s.id}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.id} · {s.status} · {s.created_at?.slice(0, 19).replace("T", " ")}
                    </div>
                  </div>
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          ) : (
            /* 事件时间线 */
            <div>
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  {detail?.title || activeId} · {detail?.status} · {detail?.events.length || 0} 条事件
                </div>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input type="checkbox" checked={hideTokens} onChange={(e) => setHideTokens(e.target.checked)} />
                  隐藏 token 流
                </label>
              </div>
              <div className="space-y-1.5">
                {shownEvents.map((e) => {
                  const meta = TYPE_META[e.type] || { label: e.type, cls: "bg-gray-100 text-gray-600" };
                  const summary = payloadSummary(e.type, e.payload);
                  return (
                    <div key={e.seq} className="flex items-start gap-2 rounded-md border bg-card px-3 py-1.5 text-sm">
                      <span className="mt-0.5 shrink-0 font-mono text-xs text-muted-foreground">#{e.seq}</span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${meta.cls}`}>{meta.label}</span>
                      <span className="min-w-0 flex-1">
                        {summary && <span className="break-words">{summary}</span>}
                        {e.type === "sandbox_exec" && e.payload.stdout && (
                          <pre className="mt-1 max-h-32 overflow-auto rounded bg-zinc-950 p-1.5 font-mono text-xs text-zinc-300">{String(e.payload.stdout).slice(0, 800)}</pre>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{e.actor}</span>
                    </div>
                  );
                })}
                {shownEvents.length === 0 && <div className="text-sm text-muted-foreground">无事件</div>}
              </div>
            </div>
          )}
        </div>
    </AppShell>
  );
}
