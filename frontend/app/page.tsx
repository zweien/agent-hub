"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth, API_BASE } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
} from "recharts";
import {
  PlaneIcon, MessageSquareIcon, SettingsIcon, WrenchIcon, PuzzleIcon,
  HistoryIcon, BoxesIcon,
} from "lucide-react";

// —— 实体类型(只取 dashboard 用到的字段) ——
interface HasPublish { is_published: boolean }
interface SessionBrief {
  id: string; status: string; title: string;
  agent_config_id: string | null; created_at: string | null;
}

const ROLE_LABEL: Record<string, string> = {
  admin: "管理员", builder: "构建者(A类)", user: "使用者(B类)",
};

// 会话状态 → 中文 + 颜色(recharts 环形图用)
const STATUS_META: Record<string, { label: string; color: string }> = {
  done:          { label: "已完成", color: "#22c55e" },
  running:       { label: "运行中", color: "#3b82f6" },
  interrupted:   { label: "已中断", color: "#f59e0b" },
  awaiting_user: { label: "待确认", color: "#a855f7" },
  human_takeover:{ label: "人工接管", color: "#ec4899" },
  idle:          { label: "空闲", color: "#94a3b8" },
};

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  // 各资源列表(用于计数 + 发布/草稿拆分)
  const [agents, setAgents] = useState<HasPublish[]>([]);
  const [tools, setTools] = useState<HasPublish[]>([]);
  const [skills, setSkills] = useState<HasPublish[]>([]);
  const [templates, setTemplates] = useState<HasPublish[]>([]);
  const [sessions, setSessions] = useState<SessionBrief[]>([]);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    // 并行拉取 4 类资源 + 最近会话(各接口已按角色过滤:B类只返回已发布,
    // builder/admin 见全量;会话 owner-scoped,admin 见全部)
    const headers = { Authorization: `Bearer ${user.token}` };
    Promise.all([
      fetch(`${API_BASE}/agents`, { headers }).then(r => r.ok ? r.json() : Promise.reject()),
      fetch(`${API_BASE}/tools`, { headers }).then(r => r.ok ? r.json() : Promise.reject()),
      fetch(`${API_BASE}/skills`, { headers }).then(r => r.ok ? r.json() : Promise.reject()),
      fetch(`${API_BASE}/sandbox-templates`, { headers }).then(r => r.ok ? r.json() : Promise.reject()),
      fetch(`${API_BASE}/sessions`, { headers }).then(r => r.ok ? r.json() : Promise.reject()),
    ]).then(([a, t, s, tpl, sess]) => {
      setAgents(a); setTools(t); setSkills(s); setTemplates(tpl); setSessions(sess);
    }).catch(() => setLoadError(true));
  }, [user]);

  if (loading || !user) return <div className="flex h-screen items-center justify-center text-muted-foreground">加载中...</div>;

  // 计数:总数 + 已发布/草稿
  const stat = (list: HasPublish[]) => ({
    total: list.length,
    published: list.filter(x => x.is_published).length,
    draft: list.filter(x => !x.is_published).length,
  });
  const agentStat = stat(agents);
  const toolStat = stat(tools);
  const skillStat = stat(skills);
  const tplStat = stat(templates);

  // 会话状态分布(环形图数据,基于最近 50 条)
  const statusCounts = sessions.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {});
  const donutData = Object.entries(statusCounts).map(([k, v]) => ({
    name: STATUS_META[k]?.label || k, value: v, key: k,
  }));
  const recentSessions = sessions.slice(0, 10);

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl p-6">
        {/* 欢迎区 + 角色 */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">欢迎,{user.username}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Agent Hub · 无人系统设计优化平台 ·{" "}
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">
                {ROLE_LABEL[user.role] || user.role}
              </span>
            </p>
          </div>
          <Link
            href="/chat"
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <MessageSquareIcon className="size-4" /> 开始对话
          </Link>
        </div>

        {loadError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
            ⚠️ 部分数据加载失败,请刷新重试
          </div>
        )}

        {/* 快捷导航卡片 */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <QuickCard href="/chat" icon={<MessageSquareIcon className="size-5" />} label="开始对话" tint="text-blue-600" />
          <QuickCard href="/agents" icon={<SettingsIcon className="size-5" />} label="Agent 配置" tint="text-violet-600" />
          <QuickCard href="/tools" icon={<WrenchIcon className="size-5" />} label="工具管理" tint="text-amber-600" />
          <QuickCard href="/skills" icon={<PuzzleIcon className="size-5" />} label="技能管理" tint="text-emerald-600" />
        </div>

        {/* 资产计数卡(4 类) */}
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">平台资源</h2>
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard href="/agents" icon={<SettingsIcon className="size-4" />} label="Agent 配置" s={agentStat} />
          <StatCard href="/tools" icon={<WrenchIcon className="size-4" />} label="工具" s={toolStat} />
          <StatCard href="/skills" icon={<PuzzleIcon className="size-4" />} label="技能" s={skillStat} />
          <StatCard href="/sandbox-templates" icon={<BoxesIcon className="size-4" />} label="沙箱模板" s={tplStat} />
        </div>

        {/* 最近会话 + 状态环形图 */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* 最近会话列表(占 2 列) */}
          <div className="lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-muted-foreground">最近会话</h2>
              <Link href="/sessions" className="text-xs text-primary hover:underline">全部 →</Link>
            </div>
            <div className="space-y-2">
              {recentSessions.length === 0 && (
                <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
                  暂无会话,去 <Link href="/chat" className="text-primary hover:underline">开始对话</Link>
                </div>
              )}
              {recentSessions.map(s => {
                const meta = STATUS_META[s.status] || { label: s.status, color: "#94a3b8" };
                return (
                  <Link
                    key={s.id}
                    href="/sessions"
                    className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:border-primary/40 hover:bg-accent/30"
                  >
                    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
                    <span className="flex-1 truncate text-sm">{s.title || "(无标题)"}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{meta.label}</span>
                    {s.created_at && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {new Date(s.created_at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>

          {/* 会话状态环形图 */}
          <div>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">最近会话状态分布</h2>
            <div className="rounded-lg border p-4">
              {donutData.length === 0 ? (
                <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">暂无数据</div>
              ) : (
                <>
                  <div className="relative h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={donutData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={45}
                          outerRadius={65}
                          paddingAngle={2}
                        >
                          {donutData.map(d => (
                            <Cell key={d.key} fill={STATUS_META[d.key]?.color || "#94a3b8"} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", fontSize: 12 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-semibold">{sessions.length}</span>
                      <span className="text-xs text-muted-foreground">会话</span>
                    </div>
                  </div>
                  {/* 图例 */}
                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
                    {donutData.map(d => (
                      <div key={d.key} className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span className="size-2 rounded-full" style={{ backgroundColor: STATUS_META[d.key]?.color || "#94a3b8" }} />
                        {d.name} {d.value}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 页脚 */}
        <div className="mt-8 flex items-center gap-2 border-t pt-4 text-xs text-muted-foreground">
          <PlaneIcon className="size-3.5" />
          Agent Hub V1 · 按 Enter 发送,数据来自现有接口实时统计
        </div>
      </div>
    </AppShell>
  );
}

// —— 快捷导航卡片 ——
function QuickCard({ href, icon, label, tint }: { href: string; icon: React.ReactNode; label: string; tint: string }) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors hover:border-primary/40 hover:bg-accent/30"
    >
      <span className={tint}>{icon}</span>
      <span className="text-sm font-medium">{label}</span>
    </Link>
  );
}

// —— 资产计数卡(总数 + 已发布/草稿) ——
function StatCard({ href, icon, label, s }: {
  href: string; icon: React.ReactNode; label: string;
  s: { total: number; published: number; draft: number };
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-lg border p-4 transition-colors hover:border-primary/40 hover:bg-accent/30"
    >
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-sm">{label}</span>
        <span className="group-hover:text-primary">{icon}</span>
      </div>
      <span className="mt-2 text-3xl font-semibold">{s.total}</span>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span>已发布 {s.published}</span>
        <span>·</span>
        <span>草稿 {s.draft}</span>
      </div>
    </Link>
  );
}
