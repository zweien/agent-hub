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

interface ModelConfig {
  id: string;
  model_id: string;        // 真实模型 id(deepseek-v4-flash)
  label: string;           // 显示名
  max_tokens: number;
  context_window: number;
  supports_reasoning: boolean;
  owner_id: string;
  is_published: boolean;
}

type TabKey = "all" | "published" | "mine";

export default function ModelsPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<TabKey>("all");
  const [selected, setSelected] = useState<ModelConfig | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  const isBuilder = user?.role === "builder" || user?.role === "admin";

  const fetchModels = async () => {
    if (!user) return;
    setLoadError(null);
    const res = await fetch(`${API_BASE}/models`, { headers: { Authorization: `Bearer ${user.token}` } });
    if (res.ok) { setModels(await res.json()); }
    else {
      const msg = res.status === 401 ? "登录已过期,请重新登录" : `加载失败(${res.status})`;
      setLoadError(msg);
      if (res.status === 401) { logout(); router.push("/login"); }
    }
  };

  useEffect(() => { fetchModels(); }, [user]);

  const filtered = useMemo(() => {
    let list = models;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(m => m.model_id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q));
    }
    if (isBuilder && tab === "published") list = list.filter(m => m.is_published);
    else if (isBuilder && tab === "mine" && user) list = list.filter(m => m.owner_id === user.username);
    return list;
  }, [models, query, tab, isBuilder, user]);

  if (loading || !user) return <div className="flex h-screen items-center justify-center text-muted-foreground">加载中...</div>;

  const openDetail = (m: ModelConfig) => {
    setSelected(m);
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
    fetchModels();
  };

  const deleteModel = async (id: string) => {
    if (!confirm("确认删除该模型?删除后下拉框将不再显示此模型。")) return;
    const res = await fetch(`${API_BASE}/models/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${user.token}` } });
    if (res.ok) {
      toast("success", "已删除");
      setSheetOpen(false);
      setSelected(null);
      fetchModels();
    } else { toast("error", "删除失败"); }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">模型管理</h1>
          {isBuilder && (
            <Button size="sm" onClick={openNew}>
              <PlusIcon className="size-4" /> 新建模型
            </Button>
          )}
        </div>

        <div className="relative mb-4">
          <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索模型 id 或显示名…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>

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

        {loadError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">⚠️ {loadError}</div>
        )}
        {filtered.length === 0 && !loadError && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {query || tab !== "all" ? "无匹配模型" : "暂无模型"}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(m => (
            <button
              key={m.id}
              onClick={() => openDetail(m)}
              className="group flex flex-col rounded-lg border p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/30"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{m.label}</span>
                <div className="flex shrink-0 items-center gap-1">
                  {m.supports_reasoning
                    ? <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[11px] text-violet-600">推理</span>
                    : <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">普通</span>}
                  {m.is_published
                    ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">已发布</span>
                    : <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">草稿</span>}
                </div>
              </div>
              <span className="mt-1 font-mono text-xs text-muted-foreground">{m.model_id}</span>
              <span className="mt-2 text-xs text-muted-foreground">
                max_tokens {m.max_tokens.toLocaleString()} · 窗口 {(m.context_window / 1024).toFixed(0)}k
              </span>
            </button>
          ))}
        </div>

        <Sheet open={sheetOpen} onOpenChange={(o) => { setSheetOpen(o); if (!o) { setSelected(null); setEditing(false); } }}>
          <SheetContent side="right" className="w-full sm:max-w-md">
            {selected || editing ? (
              <ModelDetail
                model={selected}
                isBuilder={!!isBuilder}
                editing={editing}
                token={user.token}
                onStartEdit={() => setEditing(true)}
                onCancelEdit={() => { setEditing(false); if (!selected) setSheetOpen(false); }}
                onSaved={onSaved}
                onDelete={selected ? () => deleteModel(selected.id) : undefined}
              />
            ) : null}
          </SheetContent>
        </Sheet>
      </div>
    </AppShell>
  );
}

function ModelDetail({
  model, isBuilder, editing, token, onStartEdit, onCancelEdit, onSaved, onDelete,
}: {
  model: ModelConfig | null;
  isBuilder: boolean;
  editing: boolean;
  token: string;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const toast = useToast();
  const canEdit = isBuilder;

  const [modelId, setModelId] = useState(model?.model_id || "");
  const [label, setLabel] = useState(model?.label || "");
  const [maxTokens, setMaxTokens] = useState(model?.max_tokens ?? 16000);
  const [contextWindow, setContextWindow] = useState(model?.context_window ?? 65536);
  const [reasoning, setReasoning] = useState(model?.supports_reasoning ?? false);
  const [published, setPublished] = useState(model?.is_published ?? true);

  useEffect(() => {
    setModelId(model?.model_id || "");
    setLabel(model?.label || "");
    setMaxTokens(model?.max_tokens ?? 16000);
    setContextWindow(model?.context_window ?? 65536);
    setReasoning(model?.supports_reasoning ?? false);
    setPublished(model?.is_published ?? true);
  }, [model?.id]);

  const save = async () => {
    if (!modelId.trim() || !label.trim()) { toast("error", "模型 id 和显示名必填"); return; }
    const body = {
      model_id: modelId.trim(), label: label.trim(),
      max_tokens: Number(maxTokens), context_window: Number(contextWindow),
      supports_reasoning: reasoning, is_published: published,
    };
    const url = model ? `${API_BASE}/models/${model.id}` : `${API_BASE}/models`;
    const method = model ? "PUT" : "POST";
    const res = await fetch(url, {
      method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (res.ok) { toast("success", "模型已保存"); onSaved(); }
    else {
      const msg = await res.text().catch(() => "");
      toast("error", `保存失败(${res.status}) ${msg.slice(0, 80)}`);
    }
  };

  return (
    <>
      <SheetHeader>
        <div className="flex items-center justify-between pr-8">
          <SheetTitle>{editing ? (model ? "编辑模型" : "新建模型") : (model?.label || "模型详情")}</SheetTitle>
          {!editing && canEdit && model && (
            <Button size="sm" variant="outline" onClick={onStartEdit}>
              <PencilIcon className="size-3.5" /> 编辑
            </Button>
          )}
        </div>
        <SheetDescription>
          {model ? (editing ? "修改模型配置,保存后生效" : "查看模型详情") : "创建新模型,填入真实 id 与显示名"}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-4 overflow-auto px-6 pb-2">
        {/* 模型 id */}
        <div>
          <label className="mb-1 block text-sm font-medium">模型 id <span className="text-xs text-muted-foreground">(网关真实 id,如 deepseek-v4-flash)</span></label>
          {editing ? (
            <Input value={modelId} onChange={e => setModelId(e.target.value)} className="font-mono" disabled={!canEdit} placeholder="deepseek-v4-flash" />
          ) : (
            <p className="font-mono text-sm">{model?.model_id}</p>
          )}
        </div>

        {/* 显示名 */}
        <div>
          <label className="mb-1 block text-sm font-medium">显示名 <span className="text-xs text-muted-foreground">(下拉框展示)</span></label>
          {editing ? (
            <Input value={label} onChange={e => setLabel(e.target.value)} disabled={!canEdit} placeholder="DeepSeek V4 Flash" />
          ) : (
            <p className="text-sm">{model?.label}</p>
          )}
        </div>

        {/* max_tokens */}
        <div>
          <label className="mb-1 block text-sm font-medium">max_tokens <span className="text-xs text-muted-foreground">(推理模型的 reasoning 计入)</span></label>
          {editing ? (
            <Input type="number" value={maxTokens} onChange={e => setMaxTokens(Number(e.target.value))} disabled={!canEdit} />
          ) : (
            <p className="text-sm">{model?.max_tokens.toLocaleString()}</p>
          )}
        </div>

        {/* context_window */}
        <div>
          <label className="mb-1 block text-sm font-medium">上下文窗口 <span className="text-xs text-muted-foreground">(tokens)</span></label>
          {editing ? (
            <Input type="number" value={contextWindow} onChange={e => setContextWindow(Number(e.target.value))} disabled={!canEdit} />
          ) : (
            <p className="text-sm">{model?.context_window.toLocaleString()}</p>
          )}
        </div>

        {/* reasoning 开关 */}
        {editing && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={reasoning} disabled={!canEdit} onChange={e => setReasoning(e.target.checked)} />
            推理模型(reasoning 计入 max_tokens,流式先输出推理过程)
          </label>
        )}
        {!editing && (
          <div>
            <label className="mb-1 block text-sm font-medium">类型</label>
            <p className="text-sm">{model?.supports_reasoning ? "推理模型" : "普通模型"}</p>
          </div>
        )}

        {/* 发布开关 */}
        {editing && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={published} disabled={!canEdit} onChange={e => setPublished(e.target.checked)} />
            发布(发布后 B 类用户可见、下拉框可选)
          </label>
        )}
      </div>

      {editing && (
        <SheetFooter>
          {model && canEdit && onDelete && (
            <Button variant="ghost" className="text-destructive" onClick={onDelete}>
              <TrashIcon className="size-3.5" /> 删除
            </Button>
          )}
          <Button variant="outline" onClick={onCancelEdit}>取消</Button>
          {canEdit && <Button onClick={save}>保存</Button>}
        </SheetFooter>
      )}
    </>
  );
}
