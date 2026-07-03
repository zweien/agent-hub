"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, API_BASE } from "@/contexts/auth-context";
import { Sidebar } from "@/components/sidebar";
import { Button } from "@/components/ui/button";
import { PlusIcon, ArrowLeftIcon } from "lucide-react";

interface AgentConfig {
  id: string; name: string; system_prompt: string;
  tools: string[]; model: string; mode: string;
  owner_id: string; is_published: boolean;
}

const ALL_TOOLS = [
  { id: "run_aero_tool", label: "气动分析" },
  { id: "run_sweep_in_sandbox", label: "展弦比扫描" },
];

export default function AgentsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  const [editing, setEditing] = useState<AgentConfig | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  const fetchConfigs = async () => {
    if (!user) return;
    const res = await fetch(`${API_BASE}/agents`, { headers: { Authorization: `Bearer ${user.token}` } });
    if (res.ok) setConfigs(await res.json());
  };

  useEffect(() => { fetchConfigs(); }, [user]);

  if (loading || !user) return <div className="flex h-screen items-center justify-center text-muted-foreground">加载中...</div>;

  const isBuilder = user.role === "builder" || user.role === "admin";

  const saveConfig = async (cfg: Partial<AgentConfig>) => {
    const body = {
      name: cfg.name, system_prompt: cfg.system_prompt, tools: cfg.tools || [],
      model: cfg.model || "deepseek-v4-flash", mode: cfg.mode || "standard",
      is_published: cfg.is_published ?? false,
    };
    const url = cfg.id ? `${API_BASE}/agents/${cfg.id}` : `${API_BASE}/agents`;
    const method = cfg.id ? "PUT" : "POST";
    await fetch(url, {
      method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify(body),
    });
    setShowForm(false); setEditing(null); fetchConfigs();
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl p-6">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/" className="text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-5" /></Link>
              <h1 className="text-xl font-semibold">Agent 配置</h1>
            </div>
            {isBuilder && (
              <Button onClick={() => { setEditing(null); setShowForm(true); }}>
                <PlusIcon className="size-4" /> 新建配置
              </Button>
            )}
          </div>

          {/* 配置列表 */}
          <div className="space-y-3">
            {configs.map((c) => (
              <div key={c.id} className="rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{c.name}</span>
                    {c.is_published
                      ? <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">已发布</span>
                      : <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">草稿</span>}
                  </div>
                  {isBuilder && c.owner_id === user.username && (
                    <Button size="sm" variant="outline" onClick={() => { setEditing(c); setShowForm(true); }}>编辑</Button>
                  )}
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  模型: {c.model} · 模式: {c.mode} · 工具: {c.tools.map(t => ALL_TOOLS.find(a => a.id === t)?.label || t).join(", ")}
                </div>
                <pre className="mt-2 max-h-32 overflow-auto rounded bg-muted/50 p-2 text-xs whitespace-pre-wrap">{c.system_prompt}</pre>
              </div>
            ))}
          </div>

          {/* 编辑/新建表单 */}
          {showForm && (
            <ConfigForm
              config={editing}
              isBuilder={isBuilder}
              onSave={saveConfig}
              onCancel={() => { setShowForm(false); setEditing(null); }}
            />
          )}
        </div>
      </main>
    </div>
  );
}

import Link from "next/link";

function ConfigForm({ config, isBuilder, onSave, onCancel }: {
  config: AgentConfig | null; isBuilder: boolean;
  onSave: (c: Partial<AgentConfig>) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(config?.name || "");
  const [prompt, setPrompt] = useState(config?.system_prompt || "");
  const [tools, setTools] = useState<string[]>(config?.tools || []);
  const [model, setModel] = useState(config?.model || "deepseek-v4-flash");
  const [mode, setMode] = useState(config?.mode || "standard");
  const [published, setPublished] = useState(config?.is_published || false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onCancel}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-background p-6 shadow-lg" onClick={e => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-semibold">{config ? "编辑配置" : "新建配置"}</h2>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">名称</label>
            <input className="w-full rounded-lg border px-3 py-2 text-sm" value={name} onChange={e => setName(e.target.value)} disabled={!isBuilder} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">System Prompt</label>
            <textarea className="min-h-32 w-full rounded-lg border px-3 py-2 text-sm" value={prompt} onChange={e => setPrompt(e.target.value)} disabled={!isBuilder} />
          </div>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium">模型</label>
              <select className="w-full rounded-lg border px-3 py-2 text-sm" value={model} onChange={e => setModel(e.target.value)} disabled={!isBuilder}>
                <option value="deepseek-v4-flash">DeepSeek V4 Flash</option>
                <option value="MiniMax-M-2.7">MiniMax M 2.7</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium">防护模式</label>
              <select className="w-full rounded-lg border px-3 py-2 text-sm" value={mode} onChange={e => setMode(e.target.value)} disabled={!isBuilder}>
                <option value="strict">严谨</option>
                <option value="standard">标准</option>
                <option value="yolo">YOLO</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">工具</label>
            <div className="flex gap-4">
              {ALL_TOOLS.map(t => (
                <label key={t.id} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={tools.includes(t.id)} disabled={!isBuilder}
                    onChange={e => setTools(e.target.checked ? [...tools, t.id] : tools.filter(x => x !== t.id))} />
                  {t.label}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={published} disabled={!isBuilder} onChange={e => setPublished(e.target.checked)} />
            发布(发布后 B 类用户可见)
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>取消</Button>
          {isBuilder && <Button onClick={() => onSave({ ...config, name, system_prompt: prompt, tools, model, mode, is_published: published })}>保存</Button>}
        </div>
      </div>
    </div>
  );
}
