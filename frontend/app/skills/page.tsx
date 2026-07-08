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
import { Streamdown } from "streamdown";
import {
  PlusIcon, SearchIcon, PencilIcon, TrashIcon,
} from "lucide-react";

interface Skill {
  id: string; name: string; description: string; content: string;
  scripts: string[]; script_count: number; owner_id: string; is_published: boolean;
}

type TabKey = "all" | "published" | "mine";

export default function SkillsPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 搜索 + tab(纯前端过滤)
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<TabKey>("all");
  // Sheet 详情:选中的技能 + 是否编辑态
  const [selected, setSelected] = useState<Skill | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  const isBuilder = user?.role === "builder" || user?.role === "admin";

  const fetchSkills = async () => {
    if (!user) return;
    setLoadError(null);
    const res = await fetch(`${API_BASE}/skills`, { headers: { Authorization: `Bearer ${user.token}` } });
    if (res.ok) { setSkills(await res.json()); }
    else {
      const msg = res.status === 401 ? "登录已过期,请重新登录" : `加载失败(${res.status})`;
      setLoadError(msg);
      if (res.status === 401) { logout(); router.push("/login"); }
    }
  };

  useEffect(() => { fetchSkills(); }, [user]);

  // 前端过滤:搜索(名称+描述)+ tab(须在 early-return 之前,守 rules-of-hooks)
  const filtered = useMemo(() => {
    let list = skills;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
    }
    if (isBuilder && tab === "published") list = list.filter(s => s.is_published);
    else if (isBuilder && tab === "mine" && user) list = list.filter(s => s.owner_id === user.username);
    return list;
  }, [skills, query, tab, isBuilder, user]);

  if (loading || !user) return <div className="flex h-screen items-center justify-center text-muted-foreground">加载中...</div>;

  const openDetail = (s: Skill) => {
    setSelected(s);
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
    fetchSkills();
  };

  const deleteSkill = async (id: string) => {
    if (!confirm("确认删除该技能?")) return;
    const res = await fetch(`${API_BASE}/skills/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${user.token}` } });
    if (res.ok) {
      toast("success", "已删除");
      setSheetOpen(false);
      setSelected(null);
      fetchSkills();
    } else { toast("error", "删除失败"); }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl p-6">
        {/* 顶部:标题 + 搜索 + 新建 */}
        <div className="mb-5 flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">技能管理</h1>
          {isBuilder && (
            <Button size="sm" onClick={openNew}>
              <PlusIcon className="size-4" /> 新建技能
            </Button>
          )}
        </div>

        {/* 搜索框 */}
        <div className="relative mb-4">
          <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索技能名称或描述…"
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
            {query || tab !== "all" ? "无匹配技能" : "暂无技能"}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filtered.map(s => (
            <button
              key={s.id}
              onClick={() => openDetail(s)}
              className="group flex flex-col rounded-lg border p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/30"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{s.name}</span>
                <div className="flex shrink-0 items-center gap-1">
                  {s.is_published
                    ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">已发布</span>
                    : <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">草稿</span>}
                  {s.script_count > 0 && (
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-600">{s.script_count}脚本</span>
                  )}
                </div>
              </div>
              {s.description ? (
                <span className="mt-1 line-clamp-2 text-sm text-muted-foreground">{s.description}</span>
              ) : (
                <span className="mt-1 text-sm text-muted-foreground italic">无描述</span>
              )}
            </button>
          ))}
        </div>

        {/* Sheet 详情/编辑 */}
        <Sheet open={sheetOpen} onOpenChange={(o) => { setSheetOpen(o); if (!o) { setSelected(null); setEditing(false); } }}>
          <SheetContent side="right" className="w-full sm:max-w-lg">
            {selected || editing ? (
              <SkillDetail
                skill={selected}
                isBuilder={!!isBuilder}
                editing={editing}
                token={user.token}
                onStartEdit={() => setEditing(true)}
                onCancelEdit={() => { setEditing(false); if (!selected) setSheetOpen(false); }}
                onSaved={onSaved}
                onChanged={fetchSkills}
                onDelete={selected ? () => deleteSkill(selected.id) : undefined}
              />
            ) : null}
          </SheetContent>
        </Sheet>
      </div>
    </AppShell>
  );
}

// ===== Sheet 内的技能详情/编辑(查看+编辑合一) =====
function SkillDetail({
  skill, isBuilder, editing, token, onStartEdit, onCancelEdit, onSaved, onChanged, onDelete,
}: {
  skill: Skill | null;
  isBuilder: boolean;
  editing: boolean;
  token: string;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaved: () => void;
  onChanged: () => void;
  onDelete?: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(skill?.name || "");
  const [description, setDescription] = useState(skill?.description || "");
  const [content, setContent] = useState(skill?.content || "");
  const [published, setPublished] = useState(skill?.is_published || false);
  const [scripts, setScripts] = useState<string[]>(skill?.scripts || []);
  const [uploading, setUploading] = useState(false);
  // skill 变化时重置表单(切换不同卡片)
  useEffect(() => {
    setName(skill?.name || "");
    setDescription(skill?.description || "");
    setContent(skill?.content || "");
    setPublished(skill?.is_published || false);
    setScripts(skill?.scripts || []);
  }, [skill?.id]);

  const save = async () => {
    const body = { name, description, content, scripts, is_published: published };
    const url = skill ? `${API_BASE}/skills/${skill.id}` : `${API_BASE}/skills`;
    const method = skill ? "PUT" : "POST";
    const res = await fetch(url, {
      method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (res.ok) { toast("success", "技能已保存"); onSaved(); }
    else { toast("error", `保存失败(${res.status})`); }
  };

  const uploadScript = async (file: File) => {
    if (!skill) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${API_BASE}/skills/${skill.id}/scripts`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd,
    });
    setUploading(false);
    if (res.ok) { toast("success", "脚本已上传"); onChanged(); }
    else { toast("error", "上传失败"); }
  };

  const deleteScript = async (fname: string) => {
    if (!skill) return;
    await fetch(`${API_BASE}/skills/${skill.id}/scripts/${fname}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
    onChanged();
  };

  return (
    <>
      <SheetHeader>
        <div className="flex items-center justify-between pr-8">
          <SheetTitle>{editing ? (skill ? "编辑技能" : "新建技能") : (skill?.name || "技能详情")}</SheetTitle>
          {/* 只读态下 A 类的编辑入口 */}
          {!editing && isBuilder && skill && (
            <Button size="sm" variant="outline" onClick={onStartEdit}>
              <PencilIcon className="size-3.5" /> 编辑
            </Button>
          )}
        </div>
        <SheetDescription>
          {skill
            ? (editing ? "修改技能内容,保存后生效" : "查看技能详情")
            : "创建新技能,填入 name/description/SKILL.md"}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-4 overflow-auto px-6 pb-2">
        {/* 名称 */}
        <div>
          <label className="mb-1 block text-sm font-medium">名称</label>
          {editing ? (
            <Input value={name} onChange={e => setName(e.target.value)} disabled={!isBuilder} />
          ) : (
            <p className="text-sm">{skill?.name}</p>
          )}
        </div>

        {/* 描述 */}
        <div>
          <label className="mb-1 block text-sm font-medium">
            描述 <span className="text-xs text-muted-foreground">(progressive disclosure:agent 据此决定是否加载)</span>
          </label>
          {editing ? (
            <textarea
              className="min-h-16 w-full rounded-md border px-3 py-2 text-sm"
              value={description}
              onChange={e => setDescription(e.target.value)}
              disabled={!isBuilder}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{skill?.description || "(无描述)"}</p>
          )}
        </div>

        {/* SKILL.md 正文 */}
        <div>
          <label className="mb-1 block text-sm font-medium">
            SKILL.md 正文 <span className="text-xs text-muted-foreground">(领域知识 + 工作流指令)</span>
          </label>
          {editing ? (
            <textarea
              className="min-h-48 w-full rounded-md border px-3 py-2 font-mono text-xs"
              value={content}
              onChange={e => setContent(e.target.value)}
              disabled={!isBuilder}
            />
          ) : (
            <div className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
              {skill?.content
                ? <Streamdown>{skill.content}</Streamdown>
                : <span className="text-muted-foreground italic">(无正文)</span>}
            </div>
          )}
        </div>

        {/* 脚本(仅已有 skill) */}
        {skill && (
          <div>
            <label className="mb-1 block text-sm font-medium">
              附带脚本 <span className="text-xs text-muted-foreground">(进 sandbox 共享执行)</span>
            </label>
            {editing && (
              <div className="mb-2 flex items-center gap-2">
                <input
                  type="file"
                  disabled={!isBuilder || uploading}
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadScript(f); }}
                  className="text-xs"
                />
                {uploading && <span className="text-xs text-muted-foreground">上传中…</span>}
              </div>
            )}
            <div className="space-y-1">
              {scripts.length === 0 && <span className="text-xs text-muted-foreground italic">无脚本</span>}
              {scripts.map(fn => (
                <div key={fn} className="flex items-center justify-between rounded bg-muted/40 px-2 py-1 text-xs">
                  <span className="font-mono">{fn}</span>
                  {editing && isBuilder && (
                    <button onClick={() => deleteScript(fn)} className="text-destructive hover:underline">删</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

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
          {skill && isBuilder && onDelete && (
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
