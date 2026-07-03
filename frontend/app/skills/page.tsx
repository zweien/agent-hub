"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, API_BASE } from "@/contexts/auth-context";
import { Sidebar } from "@/components/sidebar";
import { Button } from "@/components/ui/button";
import { PlusIcon, ArrowLeftIcon, UploadIcon, TrashIcon } from "lucide-react";

interface Skill {
  id: string; name: string; description: string; content: string;
  scripts: string[]; script_count: number; owner_id: string; is_published: boolean;
}

export default function SkillsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  const fetchSkills = async () => {
    if (!user) return;
    const res = await fetch(`${API_BASE}/skills`, { headers: { Authorization: `Bearer ${user.token}` } });
    if (res.ok) setSkills(await res.json());
  };

  useEffect(() => { fetchSkills(); }, [user]);

  if (loading || !user) return <div className="flex h-screen items-center justify-center text-muted-foreground">加载中...</div>;

  const isBuilder = user.role === "builder" || user.role === "admin";

  const saveSkill = async (s: Partial<Skill>) => {
    const body = {
      name: s.name, description: s.description || "", content: s.content || "",
      scripts: s.scripts || [], is_published: s.is_published ?? false,
    };
    const url = s.id ? `${API_BASE}/skills/${s.id}` : `${API_BASE}/skills`;
    const method = s.id ? "PUT" : "POST";
    await fetch(url, {
      method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify(body),
    });
    setShowForm(false); setEditing(null); fetchSkills();
  };

  const deleteSkill = async (id: string) => {
    if (!confirm("确认删除该技能?")) return;
    await fetch(`${API_BASE}/skills/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${user.token}` } });
    fetchSkills();
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl p-6">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/" className="text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-5" /></Link>
              <h1 className="text-xl font-semibold">技能管理</h1>
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">过渡期:待内核迁移后激活</span>
            </div>
            {isBuilder && (
              <Button onClick={() => { setEditing(null); setShowForm(true); }}>
                <PlusIcon className="size-4" /> 新建技能
              </Button>
            )}
          </div>

          <div className="space-y-3">
            {skills.length === 0 && <div className="text-sm text-muted-foreground">暂无技能</div>}
            {skills.map((s) => (
              <div key={s.id} className="rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    {s.is_published
                      ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">已发布</span>
                      : <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">草稿</span>}
                    {s.script_count > 0 && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">{s.script_count} 脚本</span>}
                  </div>
                  {isBuilder && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => { setEditing(s); setShowForm(true); }}>编辑</Button>
                      {(s.owner_id === user.username || user.role === "admin") && (
                        <Button size="sm" variant="ghost" onClick={() => deleteSkill(s.id)}><TrashIcon className="size-3.5 text-destructive" /></Button>
                      )}
                    </div>
                  )}
                </div>
                {s.description && <div className="mt-1 text-sm text-muted-foreground">{s.description}</div>}
                <pre className="mt-2 max-h-32 overflow-auto rounded bg-muted/50 p-2 text-xs whitespace-pre-wrap">{s.content}</pre>
              </div>
            ))}
          </div>

          {showForm && (
            <SkillForm
              skill={editing}
              isBuilder={isBuilder}
              token={user.token}
              onSave={saveSkill}
              onCancel={() => { setShowForm(false); setEditing(null); }}
              onChanged={fetchSkills}
            />
          )}
        </div>
      </main>
    </div>
  );
}

import Link from "next/link";

function SkillForm({ skill, isBuilder, token, onSave, onCancel, onChanged }: {
  skill: Skill | null; isBuilder: boolean; token: string;
  onSave: (s: Partial<Skill>) => void; onCancel: () => void; onChanged: () => void;
}) {
  const [name, setName] = useState(skill?.name || "");
  const [description, setDescription] = useState(skill?.description || "");
  const [content, setContent] = useState(skill?.content || "");
  const [published, setPublished] = useState(skill?.is_published || false);
  const [scripts, setScripts] = useState<string[]>(skill?.scripts || []);
  const [uploading, setUploading] = useState(false);

  const uploadScript = async (file: File) => {
    if (!skill) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    await fetch(`${API_BASE}/skills/${skill.id}/scripts`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd,
    });
    setUploading(false);
    onChanged();
  };

  const deleteScript = async (fname: string) => {
    if (!skill) return;
    await fetch(`${API_BASE}/skills/${skill.id}/scripts/${fname}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
    onChanged();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onCancel}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-background p-6 shadow-lg" onClick={e => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-semibold">{skill ? "编辑技能" : "新建技能"}</h2>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">名称</label>
            <input className="w-full rounded-lg border px-3 py-2 text-sm" value={name} onChange={e => setName(e.target.value)} disabled={!isBuilder} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">描述 <span className="text-xs text-muted-foreground">(progressive disclosure 关键字段,agent 据此决定是否加载)</span></label>
            <textarea className="min-h-16 w-full rounded-lg border px-3 py-2 text-sm" value={description} onChange={e => setDescription(e.target.value)} disabled={!isBuilder} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">SKILL.md 正文 <span className="text-xs text-muted-foreground">(领域知识 + 工作流指令)</span></label>
            <textarea className="min-h-40 w-full rounded-lg border px-3 py-2 font-mono text-xs" value={content} onChange={e => setContent(e.target.value)} disabled={!isBuilder} />
          </div>

          {/* 脚本上传(仅编辑已有 skill 时可用) */}
          {skill && (
            <div>
              <label className="mb-1 block text-sm font-medium">附带脚本 <span className="text-xs text-muted-foreground">(进 sandbox 共享执行)</span></label>
              <div className="flex items-center gap-2">
                <input type="file" disabled={!isBuilder || uploading} onChange={e => { const f = e.target.files?.[0]; if (f) uploadScript(f); }} className="text-xs" />
                {uploading && <span className="text-xs text-muted-foreground">上传中...</span>}
              </div>
              <div className="mt-1 space-y-1">
                {scripts.map(fn => (
                  <div key={fn} className="flex items-center justify-between rounded bg-muted/40 px-2 py-1 text-xs">
                    <span className="font-mono">{fn}</span>
                    {isBuilder && <button onClick={() => deleteScript(fn)} className="text-destructive hover:underline">删</button>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={published} disabled={!isBuilder} onChange={e => setPublished(e.target.checked)} />
            发布(发布后 B 类用户可见)
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>取消</Button>
          {isBuilder && <Button onClick={() => onSave({ ...skill, name, description, content, is_published: published, scripts })}>保存</Button>}
        </div>
      </div>
    </div>
  );
}
