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

type TabKey = "all" | "published" | "mine";

export default function ToolsPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [tools, setTools] = useState<Tool[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 搜索 + tab(纯前端过滤)
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<TabKey>("all");
  // Sheet 详情:选中的工具 + 是否编辑态
  const [selected, setSelected] = useState<Tool | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  const isBuilder = user?.role === "builder" || user?.role === "admin";

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

  // 前端过滤:搜索(名称+描述)+ tab(须在 early-return 之前,守 rules-of-hooks)
  const filtered = useMemo(() => {
    let list = tools;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(t => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
    }
    if (isBuilder && tab === "published") list = list.filter(t => t.is_published);
    else if (isBuilder && tab === "mine" && user) list = list.filter(t => t.owner_id === user.username);
    return list;
  }, [tools, query, tab, isBuilder, user]);

  if (loading || !user) return <div className="flex h-screen items-center justify-center text-muted-foreground">加载中...</div>;

  const openDetail = (t: Tool) => {
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
    fetchTools();
  };

  const deleteTool = async (id: string) => {
    if (!confirm("确认删除该工具?")) return;
    const res = await fetch(`${API_BASE}/tools/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${user.token}` } });
    if (res.ok) {
      toast("success", "已删除");
      setSheetOpen(false);
      setSelected(null);
      fetchTools();
    } else { toast("error", "删除失败"); }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl p-6">
        {/* 顶部:标题 + 新建 */}
        <div className="mb-5 flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">工具管理</h1>
          {isBuilder && (
            <Button size="sm" onClick={openNew}>
              <PlusIcon className="size-4" /> 新建工具
            </Button>
          )}
        </div>

        {/* 搜索框 */}
        <div className="relative mb-4">
          <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索工具名称或描述…"
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
            {query || tab !== "all" ? "无匹配工具" : "暂无工具"}
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
                <span className="font-mono font-medium">{t.name}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <span className={`rounded px-1.5 py-0.5 text-[11px] ${TYPE_COLOR[t.type] || "bg-muted text-muted-foreground"}`}>
                    {TYPE_LABEL[t.type] || t.type}
                  </span>
                  {t.is_published
                    ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">已发布</span>
                    : <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">草稿</span>}
                </div>
              </div>
              {t.description ? (
                <span className="mt-1 line-clamp-2 text-sm text-muted-foreground">{t.description}</span>
              ) : (
                <span className="mt-1 text-sm text-muted-foreground italic">无描述</span>
              )}
            </button>
          ))}
        </div>

        {/* Sheet 详情/编辑 */}
        <Sheet open={sheetOpen} onOpenChange={(o) => { setSheetOpen(o); if (!o) { setSelected(null); setEditing(false); } }}>
          <SheetContent side="right" className="w-full sm:max-w-2xl">
            {selected || editing ? (
              <ToolDetail
                tool={selected}
                isBuilder={!!isBuilder}
                editing={editing}
                token={user.token}
                onStartEdit={() => setEditing(true)}
                onCancelEdit={() => { setEditing(false); if (!selected) setSheetOpen(false); }}
                onSaved={onSaved}
                onDelete={selected && selected.type !== "builtin" ? () => deleteTool(selected.id) : undefined}
              />
            ) : null}
          </SheetContent>
        </Sheet>
      </div>
    </AppShell>
  );
}

// ===== Sheet 内的工具详情/编辑(查看+编辑合一) =====
function ToolDetail({
  tool, isBuilder, editing, token, onStartEdit, onCancelEdit, onSaved, onDelete,
}: {
  tool: Tool | null;
  isBuilder: boolean;
  editing: boolean;
  token: string;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const toast = useToast();
  // builtin 工具只读,不允许进入编辑态
  const isBuiltin = tool?.type === "builtin";
  const canEdit = isBuilder && !isBuiltin;

  const [name, setName] = useState(tool?.name || "");
  const [description, setDescription] = useState(tool?.description || "");
  const [type, setType] = useState(tool?.type || "python");
  const [configText, setConfigText] = useState(JSON.stringify(tool?.config || {}, null, 2));
  const [schemaText, setSchemaText] = useState(JSON.stringify(tool?.params_schema || {}, null, 2));
  const [published, setPublished] = useState(tool?.is_published || false);

  // tool 变化时重置表单(切换不同卡片)
  useEffect(() => {
    setName(tool?.name || "");
    setDescription(tool?.description || "");
    setType(tool?.type || "python");
    setConfigText(JSON.stringify(tool?.config || {}, null, 2));
    setSchemaText(JSON.stringify(tool?.params_schema || {}, null, 2));
    setPublished(tool?.is_published || false);
  }, [tool?.id]);

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

  const save = async () => {
    let cfg = {}, sch = {};
    try { cfg = JSON.parse(configText); } catch { alert("config JSON 格式错误"); return; }
    try { sch = JSON.parse(schemaText); } catch { alert("params_schema JSON 格式错误"); return; }
    const body = { name, description, type, config: cfg, params_schema: sch, is_published: published };
    const url = tool ? `${API_BASE}/tools/${tool.id}` : `${API_BASE}/tools`;
    const method = tool ? "PUT" : "POST";
    const res = await fetch(url, {
      method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (res.ok) { toast("success", "工具已保存"); onSaved(); }
    else {
      const msg = await res.text().catch(() => "");
      toast("error", `保存失败(${res.status}) ${msg.slice(0, 80)}`);
    }
  };

  return (
    <>
      <SheetHeader>
        <div className="flex items-center justify-between pr-8">
          <SheetTitle>{editing ? (tool ? "编辑工具" : "新建工具") : (tool?.name || "工具详情")}</SheetTitle>
          {/* 只读态下 A 类(且非 builtin)的编辑入口 */}
          {!editing && canEdit && tool && (
            <Button size="sm" variant="outline" onClick={onStartEdit}>
              <PencilIcon className="size-3.5" /> 编辑
            </Button>
          )}
        </div>
        <SheetDescription>
          {isBuiltin
            ? "内置工具(系统预置,只读)"
            : tool
              ? (editing ? "修改工具,保存后生效" : "查看工具详情")
              : "创建新工具,填入名称/类型/配置"}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-4 overflow-auto px-6 pb-2">
        {/* 名称 */}
        <div>
          <label className="mb-1 block text-sm font-medium">名称 <span className="text-xs text-muted-foreground">(LLM function-call 用,英文唯一)</span></label>
          {editing ? (
            <Input value={name} onChange={e => setName(e.target.value)} className="font-mono" disabled={!canEdit} />
          ) : (
            <p className="font-mono text-sm">{tool?.name}</p>
          )}
        </div>

        {/* 描述 */}
        <div>
          <label className="mb-1 block text-sm font-medium">描述 <span className="text-xs text-muted-foreground">(给 LLM,决定它何时调用)</span></label>
          {editing ? (
            <textarea
              className="min-h-16 w-full rounded-md border px-3 py-2 text-sm"
              value={description}
              onChange={e => setDescription(e.target.value)}
              disabled={!canEdit}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{tool?.description || "(无描述)"}</p>
          )}
        </div>

        {/* 类型 */}
        <div>
          <label className="mb-1 block text-sm font-medium">类型</label>
          {editing ? (
            <select className="w-full rounded-md border px-3 py-2 text-sm" value={type} onChange={e => setType(e.target.value)} disabled={!canEdit}>
              <option value="python">Python(脚本,在 sandbox 跑)</option>
              <option value="bash">Bash(脚本,在 sandbox 跑)</option>
              <option value="web">Web API(HTTP 转发)</option>
              <option value="mcp">MCP(MCP server)</option>
            </select>
          ) : (
            <p className="text-sm">{TYPE_LABEL[tool?.type || ""] || tool?.type}</p>
          )}
        </div>

        {/* 配置 */}
        <div>
          <label className="mb-1 flex items-center justify-between text-sm font-medium">
            <span>配置 (config)</span>
            {editing && canEdit && (
              <button type="button" onClick={applyTemplate} className="text-xs text-primary hover:underline">填模板</button>
            )}
          </label>
          {editing ? (
            <textarea
              className="min-h-28 w-full rounded-md border px-3 py-2 font-mono text-xs"
              value={configText}
              onChange={e => setConfigText(e.target.value)}
              disabled={!canEdit}
            />
          ) : (
            <pre className="max-h-60 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
              {JSON.stringify(tool?.config || {}, null, 2)}
            </pre>
          )}
        </div>

        {/* 入参 schema */}
        <div>
          <label className="mb-1 block text-sm font-medium">入参 schema <span className="text-xs text-muted-foreground">(JSON Schema,给 LLM 生成参数)</span></label>
          {editing ? (
            <textarea
              className="min-h-24 w-full rounded-md border px-3 py-2 font-mono text-xs"
              value={schemaText}
              onChange={e => setSchemaText(e.target.value)}
              disabled={!canEdit}
            />
          ) : (
            <pre className="max-h-60 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
              {JSON.stringify(tool?.params_schema || {}, null, 2)}
            </pre>
          )}
        </div>

        {/* 发布开关(编辑态) */}
        {editing && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={published} disabled={!canEdit} onChange={e => setPublished(e.target.checked)} />
            发布(发布后 B 类用户可见)
          </label>
        )}
      </div>

      {/* 底部操作(编辑态) */}
      {editing && (
        <SheetFooter>
          {tool && canEdit && onDelete && (
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
