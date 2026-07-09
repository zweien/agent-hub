"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth, API_BASE } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { PlusIcon, SearchIcon, PencilIcon, TrashIcon } from "lucide-react";

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

type TabKey = "all" | "published" | "mine";

export default function SandboxTemplatesPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [templates, setTemplates] = useState<SandboxTemplate[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 搜索 + tab(纯前端过滤)
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<TabKey>("all");
  // Sheet 详情:选中的模板 + 是否编辑态
  const [selected, setSelected] = useState<SandboxTemplate | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  const isBuilder = user?.role === "builder" || user?.role === "admin";

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

  // 前端过滤:搜索(名称+基础镜像)+ tab(须在 early-return 之前,守 rules-of-hooks)
  const filtered = useMemo(() => {
    let list = templates;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(t => t.name.toLowerCase().includes(q) || t.base_image.toLowerCase().includes(q));
    }
    if (isBuilder && tab === "published") list = list.filter(t => t.is_published);
    else if (isBuilder && tab === "mine" && user) list = list.filter(t => t.owner_id === user.username);
    return list;
  }, [templates, query, tab, isBuilder, user]);

  if (loading || !user) return <div className="flex h-screen items-center justify-center text-muted-foreground">加载中...</div>;

  const openDetail = (t: SandboxTemplate) => {
    setSelected(t);
    setEditing(false);
    setSheetOpen(true);
  };

  const openNew = () => {
    setSelected(null);
    setEditing(true);
    setSheetOpen(true);
  };

  const onSaved = () => {
    setSheetOpen(false);
    setSelected(null);
    setEditing(false);
    fetchTemplates();
  };

  const deleteTemplate = async (id: string) => {
    if (!confirm("确认删除该沙箱模板?")) return;
    const res = await fetch(`${API_BASE}/sandbox-templates/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${user.token}` } });
    if (res.ok) {
      toast("success", "已删除");
      setSheetOpen(false);
      setSelected(null);
      fetchTemplates();
    } else { toast("error", "删除失败"); }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl p-6">
        {/* 顶部:标题 + 新建 */}
        <div className="mb-5 flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">沙箱模板</h1>
          {isBuilder && (
            <Button size="sm" onClick={openNew}>
              <PlusIcon className="size-4" /> 新建模板
            </Button>
          )}
        </div>

        {/* 搜索框 */}
        <div className="relative mb-4">
          <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索模板名称或基础镜像…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>

        {/* A 类 tab(B 类后端已只返回已发布,无需 tab) */}
        {isBuilder && (
          <div className="mb-4 flex gap-1 rounded-lg bg-muted/50 p-1">
            {([
              { k: "all", label: "全部" },
              { k: "published", label: "已发布" },
              { k: "mine", label: "我的" },
            ] as { k: TabKey; label: string }[]).map(t => (
              <button
                key={t.k}
                onClick={() => setTab(t.k)}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
                  tab === t.k ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* 网格卡片 */}
        {loadError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">⚠️ {loadError}</div>
        )}
        {filtered.length === 0 && !loadError && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {query || tab !== "all" ? "无匹配模板" : "暂无模板"}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(t => (
            <button
              key={t.id}
              onClick={() => openDetail(t)}
              className="group flex flex-col rounded-lg border p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/30"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{t.name}</span>
                <div className="flex shrink-0 items-center gap-1">
                  {t.is_published
                    ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">已发布</span>
                    : <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">草稿</span>}
                  {t.pip_packages.length > 0 && (
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-600">{t.pip_packages.length}包</span>
                  )}
                </div>
              </div>
              <span className="mt-1 truncate font-mono text-xs text-muted-foreground">{t.base_image}</span>
              <span className="mt-1 line-clamp-1 text-sm text-muted-foreground">{hwSummary(t)}</span>
            </button>
          ))}
        </div>

        {/* Sheet 详情/编辑 */}
        <Sheet open={sheetOpen} onOpenChange={(o) => { setSheetOpen(o); if (!o) { setSelected(null); setEditing(false); } }}>
          <SheetContent side="right" className="w-full sm:max-w-2xl">
            {selected || editing ? (
              <TemplateDetail
                template={selected}
                isBuilder={!!isBuilder}
                editing={editing}
                token={user.token}
                onStartEdit={() => setEditing(true)}
                onCancelEdit={() => { setEditing(false); if (!selected) setSheetOpen(false); }}
                onSaved={onSaved}
                onDelete={selected ? () => deleteTemplate(selected.id) : undefined}
              />
            ) : null}
          </SheetContent>
        </Sheet>
      </div>
    </AppShell>
  );
}

// ===== Sheet 内的模板详情/编辑(查看+编辑合一) =====
function TemplateDetail({
  template, isBuilder, editing, token, onStartEdit, onCancelEdit, onSaved, onDelete,
}: {
  template: SandboxTemplate | null;
  isBuilder: boolean;
  editing: boolean;
  token: string;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(template?.name || "");
  const [baseImage, setBaseImage] = useState(template?.base_image || "agent-hub-sandbox:latest");
  const [pipPackages, setPipPackages] = useState((template?.pip_packages || []).join(", "));
  const [envVarsText, setEnvVarsText] = useState(JSON.stringify(template?.env_vars || {}, null, 2));
  const [cpuLimit, setCpuLimit] = useState(template?.cpu_limit?.toString() || "");
  const [memLimit, setMemLimit] = useState(template?.mem_limit || "");
  const [gpuCount, setGpuCount] = useState((template?.gpu_count || 0).toString());
  const [shmSize, setShmSize] = useState(template?.shm_size || "");
  const [published, setPublished] = useState(template?.is_published || false);

  // template 变化时重置表单(切换不同卡片)
  useEffect(() => {
    setName(template?.name || "");
    setBaseImage(template?.base_image || "agent-hub-sandbox:latest");
    setPipPackages((template?.pip_packages || []).join(", "));
    setEnvVarsText(JSON.stringify(template?.env_vars || {}, null, 2));
    setCpuLimit(template?.cpu_limit?.toString() || "");
    setMemLimit(template?.mem_limit || "");
    setGpuCount((template?.gpu_count || 0).toString());
    setShmSize(template?.shm_size || "");
    setPublished(template?.is_published || false);
  }, [template?.id]);

  const save = async () => {
    let envVars = {};
    try { envVars = JSON.parse(envVarsText); } catch { alert("环境变量 JSON 格式错误"); return; }
    const body = {
      name, base_image: baseImage || "agent-hub-sandbox:latest",
      pip_packages: pipPackages.split(",").map(s => s.trim()).filter(Boolean),
      env_vars: envVars,
      cpu_limit: cpuLimit ? parseFloat(cpuLimit) : null,
      mem_limit: memLimit || null,
      gpu_count: parseInt(gpuCount) || 0,
      shm_size: shmSize || null,
      is_published: published,
    };
    const url = template ? `${API_BASE}/sandbox-templates/${template.id}` : `${API_BASE}/sandbox-templates`;
    const method = template ? "PUT" : "POST";
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    if (res.ok) { toast("success", "模板已保存"); onSaved(); }
    else { toast("error", `保存失败(${res.status})`); }
  };

  return (
    <>
      <SheetHeader>
        <div className="flex items-center justify-between pr-8">
          <SheetTitle>{editing ? (template ? "编辑模板" : "新建模板") : (template?.name || "模板详情")}</SheetTitle>
          {/* 只读态下 A 类的编辑入口 */}
          {!editing && isBuilder && template && (
            <Button size="sm" variant="outline" onClick={onStartEdit}>
              <PencilIcon className="size-3.5" /> 编辑
            </Button>
          )}
        </div>
        <SheetDescription>
          {template
            ? (editing ? "修改模板,保存后生效" : "查看模板详情(镜像 + 包 + 硬件配置)")
            : "创建新沙箱模板"}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-4 overflow-auto px-6 pb-2">
        {/* 名称 */}
        <div>
          <label className="mb-1 block text-sm font-medium">名称</label>
          {editing ? (
            <Input value={name} onChange={e => setName(e.target.value)} disabled={!isBuilder} />
          ) : (
            <p className="text-sm">{template?.name}</p>
          )}
        </div>

        {/* 基础镜像 */}
        <div>
          <label className="mb-1 block text-sm font-medium">基础镜像</label>
          {editing ? (
            <Input value={baseImage} onChange={e => setBaseImage(e.target.value)} className="font-mono text-xs" disabled={!isBuilder} />
          ) : (
            <p className="font-mono text-xs">{template?.base_image}</p>
          )}
        </div>

        {/* 硬件配置 2x2 */}
        <div>
          <label className="mb-1 block text-sm font-medium">硬件配置</label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">CPU 核数(空=不限)</label>
              {editing ? (
                <Input value={cpuLimit} onChange={e => setCpuLimit(e.target.value)} placeholder="如 2.0" disabled={!isBuilder} />
              ) : (
                <p className="text-sm">{template?.cpu_limit ?? "不限"}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">内存上限(空=不限)</label>
              {editing ? (
                <Input value={memLimit} onChange={e => setMemLimit(e.target.value)} placeholder="如 4g" disabled={!isBuilder} />
              ) : (
                <p className="text-sm">{template?.mem_limit || "不限"}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">GPU 数量(0=不用)</label>
              {editing ? (
                <Input value={gpuCount} onChange={e => setGpuCount(e.target.value)} placeholder="0" disabled={!isBuilder} />
              ) : (
                <p className="text-sm">{template?.gpu_count ?? 0}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">共享内存(空=默认)</label>
              {editing ? (
                <Input value={shmSize} onChange={e => setShmSize(e.target.value)} placeholder="如 2g" disabled={!isBuilder} />
              ) : (
                <p className="text-sm">{template?.shm_size || "默认"}</p>
              )}
            </div>
          </div>
        </div>

        {/* 额外 pip 包 */}
        <div>
          <label className="mb-1 block text-sm font-medium">额外 pip 包 <span className="text-xs text-muted-foreground">(逗号分隔,运行时装)</span></label>
          {editing ? (
            <Input value={pipPackages} onChange={e => setPipPackages(e.target.value)} className="font-mono text-xs" placeholder="scipy, pandas" disabled={!isBuilder} />
          ) : (
            <p className="font-mono text-xs text-muted-foreground">
              {template && template.pip_packages.length > 0 ? template.pip_packages.join(", ") : "(无)"}
            </p>
          )}
        </div>

        {/* 环境变量 */}
        <div>
          <label className="mb-1 block text-sm font-medium">环境变量 <span className="text-xs text-muted-foreground">(JSON)</span></label>
          {editing ? (
            <textarea
              className="min-h-16 w-full rounded-md border px-3 py-2 font-mono text-xs"
              value={envVarsText}
              onChange={e => setEnvVarsText(e.target.value)}
              disabled={!isBuilder}
            />
          ) : (
            <pre className="max-h-40 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
              {JSON.stringify(template?.env_vars || {}, null, 2)}
            </pre>
          )}
        </div>

        {/* 发布开关(编辑态) */}
        {editing && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={published} disabled={!isBuilder} onChange={e => setPublished(e.target.checked)} />
            发布(发布后 B 类用户可见)
          </label>
        )}
      </div>

      {/* 底部操作(编辑态) */}
      {editing && (
        <SheetFooter>
          {template && isBuilder && onDelete && (
            <Button variant="ghost" className="text-destructive" onClick={onDelete}>
              <TrashIcon className="size-3.5" /> 删除
            </Button>
          )}
          <Button variant="outline" onClick={onCancelEdit}>取消</Button>
          {isBuilder && <Button onClick={save}>保存</Button>}
        </SheetFooter>
      )}
    </>
  );
}
