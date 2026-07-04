"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, API_BASE } from "@/contexts/auth-context";
import { Sidebar } from "@/components/sidebar";
import { Button } from "@/components/ui/button";
import { PlusIcon, ArrowLeftIcon, TrashIcon } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import Link from "next/link";

interface SandboxTemplate {
  id: string; name: string; base_image: string;
  pip_packages: string[]; env_vars: Record<string, string>;
  cpu_limit: number | null; mem_limit: string | null;
  gpu_count: number; shm_size: string | null;
  owner_id: string; is_published: boolean;
}

function hwSummary(t: SandboxTemplate): string {
  const parts: string[] = [];
  parts.push(t.cpu_limit ? `${t.cpu_limit}核` : "CPU不限");
  parts.push(t.mem_limit || "内存不限");
  if (t.gpu_count > 0) parts.push(`GPU×${t.gpu_count}`);
  if (t.shm_size) parts.push(`shm ${t.shm_size}`);
  return parts.join(" · ");
}

export default function SandboxTemplatesPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [templates, setTemplates] = useState<SandboxTemplate[]>([]);
  const [editing, setEditing] = useState<SandboxTemplate | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  const fetchTemplates = async () => {
    if (!user) return;
    setLoadError(null);
    const res = await fetch(`${API_BASE}/sandbox-templates`, { headers: { Authorization: `Bearer ${user.token}` } });
    if (res.ok) { setTemplates(await res.json()); }
    else {
      const msg = res.status === 401 ? "登录已过期" : `加载失败(${res.status})`;
      setLoadError(msg);
      if (res.status === 401) { logout(); router.push("/login"); }
    }
  };
  useEffect(() => { fetchTemplates(); }, [user]);

  if (loading || !user) return <div className="flex h-screen items-center justify-center text-muted-foreground">加载中...</div>;

  const isBuilder = user.role === "builder" || user.role === "admin";

  const saveTemplate = async (t: Partial<SandboxTemplate>) => {
    const body = {
      name: t.name, base_image: t.base_image || "agent-hub-sandbox:latest",
      pip_packages: t.pip_packages || [], env_vars: t.env_vars || {},
      cpu_limit: t.cpu_limit ?? null, mem_limit: t.mem_limit || null,
      gpu_count: t.gpu_count ?? 0, shm_size: t.shm_size || null,
      is_published: t.is_published ?? false,
    };
    const url = t.id ? `${API_BASE}/sandbox-templates/${t.id}` : `${API_BASE}/sandbox-templates`;
    const method = t.id ? "PUT" : "POST";
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` }, body: JSON.stringify(body) });
    if (res.ok) { toast("success", "模板已保存"); setShowForm(false); setEditing(null); fetchTemplates(); }
    else { toast("error", `保存失败(${res.status})`); }
  };

  const deleteTemplate = async (id: string) => {
    if (!confirm("确认删除该沙箱模板?")) return;
    const res = await fetch(`${API_BASE}/sandbox-templates/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${user.token}` } });
    if (res.ok) { toast("success", "已删除"); fetchTemplates(); }
    else { toast("error", "删除失败"); }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl p-6">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/" className="text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-5" /></Link>
              <h1 className="text-xl font-semibold">沙箱模板</h1>
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">预置包 + 硬件配置</span>
            </div>
            {isBuilder && (
              <Button onClick={() => { setEditing(null); setShowForm(true); }}>
                <PlusIcon className="size-4" /> 新建模板
              </Button>
            )}
          </div>

          {loadError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">⚠️ {loadError}</div>}

          <div className="space-y-3">
            {templates.length === 0 && !loadError && <div className="text-sm text-muted-foreground">暂无模板</div>}
            {templates.map((t) => (
              <div key={t.id} className="rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t.name}</span>
                    {t.is_published
                      ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">已发布</span>
                      : <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">草稿</span>}
                    {t.pip_packages.length > 0 && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">{t.pip_packages.length} 包</span>}
                  </div>
                  {isBuilder && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => { setEditing(t); setShowForm(true); }}>编辑</Button>
                      {(t.owner_id === user.username || user.role === "admin") && (
                        <Button size="sm" variant="ghost" onClick={() => deleteTemplate(t.id)}><TrashIcon className="size-3.5 text-destructive" /></Button>
                      )}
                    </div>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted-foreground font-mono">{t.base_image}</div>
                <div className="mt-1 text-sm text-muted-foreground">{hwSummary(t)}</div>
                {t.pip_packages.length > 0 && <div className="mt-1 text-xs text-muted-foreground">pip: {t.pip_packages.join(", ")}</div>}
              </div>
            ))}
          </div>

          {showForm && (
            <TemplateForm template={editing} isBuilder={isBuilder} onSave={saveTemplate} onCancel={() => { setShowForm(false); setEditing(null); }} />
          )}
        </div>
      </main>
    </div>
  );
}

function TemplateForm({ template, isBuilder, onSave, onCancel }: {
  template: SandboxTemplate | null; isBuilder: boolean;
  onSave: (t: Partial<SandboxTemplate>) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(template?.name || "");
  const [baseImage, setBaseImage] = useState(template?.base_image || "agent-hub-sandbox:latest");
  const [pipPackages, setPipPackages] = useState((template?.pip_packages || []).join(", "));
  const [envVarsText, setEnvVarsText] = useState(JSON.stringify(template?.env_vars || {}, null, 2));
  const [cpuLimit, setCpuLimit] = useState(template?.cpu_limit?.toString() || "");
  const [memLimit, setMemLimit] = useState(template?.mem_limit || "");
  const [gpuCount, setGpuCount] = useState((template?.gpu_count || 0).toString());
  const [shmSize, setShmSize] = useState(template?.shm_size || "");
  const [published, setPublished] = useState(template?.is_published || false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onCancel}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-background p-6 shadow-lg" onClick={e => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-semibold">{template ? "编辑模板" : "新建模板"}</h2>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">名称</label>
            <input className="w-full rounded-lg border px-3 py-2 text-sm" value={name} onChange={e => setName(e.target.value)} disabled={!isBuilder} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">基础镜像</label>
            <input className="w-full rounded-lg border px-3 py-2 font-mono text-xs" value={baseImage} onChange={e => setBaseImage(e.target.value)} disabled={!isBuilder} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">CPU 核数 <span className="text-xs text-muted-foreground">(空=不限)</span></label>
              <input className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="如 2.0" value={cpuLimit} onChange={e => setCpuLimit(e.target.value)} disabled={!isBuilder} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">内存上限 <span className="text-xs text-muted-foreground">(空=不限)</span></label>
              <input className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="如 4g" value={memLimit} onChange={e => setMemLimit(e.target.value)} disabled={!isBuilder} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">GPU 数量 <span className="text-xs text-muted-foreground">(0=不用)</span></label>
              <input className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="0" value={gpuCount} onChange={e => setGpuCount(e.target.value)} disabled={!isBuilder} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">共享内存 <span className="text-xs text-muted-foreground">(空=默认)</span></label>
              <input className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="如 2g" value={shmSize} onChange={e => setShmSize(e.target.value)} disabled={!isBuilder} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">额外 pip 包 <span className="text-xs text-muted-foreground">(逗号分隔,运行时装)</span></label>
            <input className="w-full rounded-lg border px-3 py-2 font-mono text-xs" placeholder="scipy, pandas" value={pipPackages} onChange={e => setPipPackages(e.target.value)} disabled={!isBuilder} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">环境变量 <span className="text-xs text-muted-foreground">(JSON)</span></label>
            <textarea className="min-h-16 w-full rounded-lg border px-3 py-2 font-mono text-xs" value={envVarsText} onChange={e => setEnvVarsText(e.target.value)} disabled={!isBuilder} />
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
              let envVars = {};
              try { envVars = JSON.parse(envVarsText); } catch { alert("环境变量 JSON 格式错误"); return; }
              onSave({
                ...template, name, base_image: baseImage,
                pip_packages: pipPackages.split(",").map(s => s.trim()).filter(Boolean),
                env_vars: envVars,
                cpu_limit: cpuLimit ? parseFloat(cpuLimit) : null,
                mem_limit: memLimit || null,
                gpu_count: parseInt(gpuCount) || 0,
                shm_size: shmSize || null,
                is_published: published,
              });
            }}>保存</Button>
          )}
        </div>
      </div>
    </div>
  );
}
