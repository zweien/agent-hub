"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, API_BASE } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { PlusIcon, ArrowLeftIcon, TrashIcon } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import Link from "next/link";

interface Tool {
  id: string; name: string; description: string; type: string;
  config: Record<string, unknown>; params_schema: Record<string, unknown>;
  owner_id: string; is_published: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  python: "Python", bash: "Bash", web: "Web API", mcp: "MCP", builtin: "内置",
};
const TYPE_COLOR: Record<string, string> = {
  python: "bg-green-50 text-green-600", bash: "bg-amber-50 text-amber-600",
  web: "bg-blue-50 text-blue-600", mcp: "bg-violet-50 text-violet-600", builtin: "bg-muted text-muted-foreground",
};

export default function ToolsPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const [tools, setTools] = useState<Tool[]>([]);
  const [editing, setEditing] = useState<Tool | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  const fetchTools = async () => {
    if (!user) return;
    setLoadError(null);
    const res = await fetch(`${API_BASE}/tools`, { headers: { Authorization: `Bearer ${user.token}` } });
    if (res.ok) { setTools(await res.json()); }
    else {
      const msg = res.status === 401 ? "登录已过期,请重新登录" : `加载失败(${res.status})`;
      setLoadError(msg);
      if (res.status === 401) { logout(); router.push("/login"); }
    }
  };
  useEffect(() => { fetchTools(); }, [user]);

  if (loading || !user) return <div className="flex h-screen items-center justify-center text-muted-foreground">加载中...</div>;

  const isBuilder = user.role === "builder" || user.role === "admin";

  const saveTool = async (t: Partial<Tool>) => {
    const body = {
      name: t.name, description: t.description || "", type: t.type || "python",
      config: t.config || {}, params_schema: t.params_schema || {}, is_published: t.is_published ?? false,
    };
    const url = t.id && !t.id.startsWith("run_") ? `${API_BASE}/tools/${t.id}` : `${API_BASE}/tools`;
    const method = t.id && !t.id.startsWith("run_") ? "PUT" : "POST";
    const res = await fetch(url, {
      method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify(body),
    });
    if (res.ok) { toast("success", "工具已保存"); setShowForm(false); setEditing(null); fetchTools(); }
    else { const msg = await res.text().catch(() => ""); toast("error", `保存失败(${res.status}) ${msg.slice(0, 80)}`); }
  };

  const deleteTool = async (id: string) => {
    if (!confirm("确认删除该工具?")) return;
    const res = await fetch(`${API_BASE}/tools/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${user.token}` } });
    if (res.ok) { toast("success", "已删除"); fetchTools(); }
    else { toast("error", "删除失败"); }
  };

  return (
    <AppShell>
        <div className="mx-auto max-w-3xl p-6">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/" className="text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-5" /></Link>
              <h1 className="text-xl font-semibold">工具管理</h1>
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Python/Bash/Web/MCP</span>
            </div>
            {isBuilder && (
              <Button onClick={() => { setEditing(null); setShowForm(true); }}>
                <PlusIcon className="size-4" /> 新建工具
              </Button>
            )}
          </div>

          <div className="space-y-3">
            {loadError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">⚠️ {loadError}</div>}
            {tools.length === 0 && !loadError && <div className="text-sm text-muted-foreground">暂无工具</div>}
            {tools.map((t) => (
              <div key={t.id} className="rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium">{t.name}</span>
                    <span className={`rounded px-1.5 py-0.5 text-xs ${TYPE_COLOR[t.type] || "bg-muted text-muted-foreground"}`}>{TYPE_LABEL[t.type] || t.type}</span>
                    {t.is_published
                      ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">已发布</span>
                      : <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">草稿</span>}
                  </div>
                  {isBuilder && t.type !== "builtin" && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => { setEditing(t); setShowForm(true); }}>编辑</Button>
                      {(t.owner_id === user.username || user.role === "admin") && (
                        <Button size="sm" variant="ghost" onClick={() => deleteTool(t.id)}><TrashIcon className="size-3.5 text-destructive" /></Button>
                      )}
                    </div>
                  )}
                </div>
                {t.description && <div className="mt-1 text-sm text-muted-foreground">{t.description}</div>}
              </div>
            ))}
          </div>

          {showForm && (
            <ToolForm tool={editing} isBuilder={isBuilder} onSave={saveTool} onCancel={() => { setShowForm(false); setEditing(null); }} />
          )}
        </div>
    </AppShell>
  );
}

function ToolForm({ tool, isBuilder, onSave, onCancel }: {
  tool: Tool | null; isBuilder: boolean;
  onSave: (t: Partial<Tool>) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(tool?.name || "");
  const [description, setDescription] = useState(tool?.description || "");
  const [type, setType] = useState(tool?.type || "python");
  const [configText, setConfigText] = useState(JSON.stringify(tool?.config || {}, null, 2));
  const [schemaText, setSchemaText] = useState(JSON.stringify(tool?.params_schema || {}, null, 2));
  const [published, setPublished] = useState(tool?.is_published || false);

  // 按 type 给配置模板提示
  const configTemplate: Record<string, string> = {
    python: '{"code": "result = a + b\\nprint(result)", "workdir": "/tmp"}',
    bash: '{"code": "echo $A $B", "workdir": "/tmp"}',
    web: '{"url": "https://api.example.com/echo", "method": "GET", "headers": {}, "auth_header": ""}',
    mcp: '{"server_url": "http://localhost:8000/sse", "tool_filter": []}',
  };

  const applyTemplate = () => {
    try { setConfigText(JSON.stringify(JSON.parse(configTemplate[type]), null, 2)); } catch { setConfigText(configTemplate[type]); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onCancel}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-background p-6 shadow-lg" onClick={e => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-semibold">{tool ? "编辑工具" : "新建工具"}</h2>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">名称 <span className="text-xs text-muted-foreground">(LLM function-call 用,英文唯一)</span></label>
            <input className="w-full rounded-lg border px-3 py-2 font-mono text-sm" value={name} onChange={e => setName(e.target.value)} disabled={!isBuilder} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">描述 <span className="text-xs text-muted-foreground">(给 LLM,决定它何时调用)</span></label>
            <textarea className="min-h-16 w-full rounded-lg border px-3 py-2 text-sm" value={description} onChange={e => setDescription(e.target.value)} disabled={!isBuilder} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">类型</label>
            <select className="w-full rounded-lg border px-3 py-2 text-sm" value={type} onChange={e => setType(e.target.value)} disabled={!isBuilder}>
              <option value="python">Python(脚本,在 sandbox 跑)</option>
              <option value="bash">Bash(脚本,在 sandbox 跑)</option>
              <option value="web">Web API(HTTP 转发)</option>
              <option value="mcp">MCP(MCP server)</option>
            </select>
          </div>
          <div>
            <label className="mb-1 flex items-center justify-between text-sm font-medium">
              <span>配置 (config)</span>
              <button type="button" onClick={applyTemplate} className="text-xs text-primary hover:underline">填模板</button>
            </label>
            <textarea className="min-h-28 w-full rounded-lg border px-3 py-2 font-mono text-xs" value={configText} onChange={e => setConfigText(e.target.value)} disabled={!isBuilder} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">入参 schema <span className="text-xs text-muted-foreground">(JSON Schema,给 LLM 生成参数)</span></label>
            <textarea className="min-h-24 w-full rounded-lg border px-3 py-2 font-mono text-xs" value={schemaText} onChange={e => setSchemaText(e.target.value)} disabled={!isBuilder} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={published} disabled={!isBuilder} onChange={e => setPublished(e.target.checked)} />
            发布(发布后 B 类用户可见)
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>取消</Button>
          {isBuilder && (
            <Button onClick={() => {
              let cfg = {}, sch = {};
              try { cfg = JSON.parse(configText); } catch { alert("config JSON 格式错误"); return; }
              try { sch = JSON.parse(schemaText); } catch { alert("params_schema JSON 格式错误"); return; }
              onSave({ ...tool, name, description, type, config: cfg, params_schema: sch, is_published: published });
            }}>保存</Button>
          )}
        </div>
      </div>
    </div>
  );
}
