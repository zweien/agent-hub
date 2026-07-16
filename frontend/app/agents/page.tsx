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

interface AgentConfig {
  id: string; name: string; system_prompt: string;
  tools: string[]; skill_ids: string[]; sandbox_template_id: string | null;
  model: string; mode: string;
  type: string;  // flat | canvas
  subagent_types: SubagentType[];
  owner_id: string; is_published: boolean;
}

// 子代理类型(V2 §4):主 agent 调 task 工具时按 name spawn
interface SubagentType {
  name: string;
  description: string;
  prompt: string;
  tools: string[];
  model: string;
}

interface SkillBrief { id: string; name: string; description: string; is_published: boolean }
interface ToolBrief { id: string; name: string; description: string; type: string; is_published: boolean }
interface SandboxTemplateBrief { id: string; name: string; base_image: string }

const MODE_LABEL: Record<string, string> = { strict: "严谨", standard: "标准", yolo: "YOLO" };

type TabKey = "all" | "published" | "mine";

export default function AgentsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  const [skills, setSkills] = useState<SkillBrief[]>([]);
  const [availTools, setAvailTools] = useState<ToolBrief[]>([]);
  const [sbTemplates, setSbTemplates] = useState<SandboxTemplateBrief[]>([]);
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);
  // 搜索 + tab(纯前端过滤)
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<TabKey>("all");
  // Sheet 详情:选中的配置 + 是否编辑态
  const [selected, setSelected] = useState<AgentConfig | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  const isBuilder = user?.role === "builder" || user?.role === "admin";

  const fetchConfigs = async () => {
    if (!user) return;
    const res = await fetch(`${API_BASE}/agents`, { headers: { Authorization: `Bearer ${user.token}` } });
    if (res.ok) setConfigs(await res.json());
  };
  const fetchSkills = async () => {
    if (!user) return;
    const res = await fetch(`${API_BASE}/skills`, { headers: { Authorization: `Bearer ${user.token}` } });
    if (res.ok) setSkills(await res.json());
  };
  const fetchTools = async () => {
    if (!user) return;
    const res = await fetch(`${API_BASE}/tools`, { headers: { Authorization: `Bearer ${user.token}` } });
    if (res.ok) setAvailTools(await res.json());
  };
  const fetchSbTemplates = async () => {
    if (!user) return;
    const res = await fetch(`${API_BASE}/sandbox-templates`, { headers: { Authorization: `Bearer ${user.token}` } });
    if (res.ok) setSbTemplates(await res.json());
  };
  const fetchModels = async () => {
    if (!user) return;
    const res = await fetch(`${API_BASE}/models`, { headers: { Authorization: `Bearer ${user.token}` } });
    if (res.ok) setModels(await res.json());
  };

  useEffect(() => { fetchConfigs(); fetchSkills(); fetchTools(); fetchSbTemplates(); fetchModels(); }, [user]);

  // 前端过滤:搜索(名称)+ tab(须在 early-return 之前,守 rules-of-hooks)
  const filtered = useMemo(() => {
    let list = configs;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q));
    }
    if (isBuilder && tab === "published") list = list.filter(c => c.is_published);
    else if (isBuilder && tab === "mine" && user) list = list.filter(c => c.owner_id === user.username);
    return list;
  }, [configs, query, tab, isBuilder, user]);

  if (loading || !user) return <div className="flex h-screen items-center justify-center text-muted-foreground">加载中...</div>;

  const openDetail = (c: AgentConfig) => {
    setSelected(c);
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
    fetchConfigs();
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl p-6">
        {/* 顶部:标题 + 新建 */}
        <div className="mb-5 flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Agent 配置</h1>
          {isBuilder && (
            <Button size="sm" onClick={openNew}>
              <PlusIcon className="size-4" /> 新建配置
            </Button>
          )}
        </div>

        {/* 搜索框 */}
        <div className="relative mb-4">
          <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索配置名称…"
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
        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {query || tab !== "all" ? "无匹配配置" : "暂无配置"}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(c => (
            <button
              key={c.id}
              onClick={() => openDetail(c)}
              className="group flex flex-col rounded-lg border p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/30"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{c.name}</span>
                <div className="flex shrink-0 items-center gap-1">
                  {c.is_published
                    ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">已发布</span>
                    : <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">草稿</span>}
                  {c.tools.length > 0 && (
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-600">{c.tools.length}工具</span>
                  )}
                </div>
              </div>
              <span className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                {c.model} · {MODE_LABEL[c.mode] || c.mode}
              </span>
            </button>
          ))}
        </div>

        {/* Sheet 详情/编辑 */}
        <Sheet open={sheetOpen} onOpenChange={(o) => { setSheetOpen(o); if (!o) { setSelected(null); setEditing(false); } }}>
          <SheetContent side="right" className="w-full sm:max-w-2xl">
            {selected || editing ? (
              <ConfigDetail
                config={selected}
                isBuilder={!!isBuilder}
                isAdmin={user.role === "admin"}
                currentUsername={user.username}
                editing={editing}
                token={user.token}
                skills={skills}
                availTools={availTools}
                sbTemplates={sbTemplates}
                models={models}
                onStartEdit={() => setEditing(true)}
                onCancelEdit={() => { setEditing(false); if (!selected) setSheetOpen(false); }}
                onSaved={onSaved}
              />
            ) : null}
          </SheetContent>
        </Sheet>
      </div>
    </AppShell>
  );
}

// ===== Sheet 内的配置详情/编辑(查看+编辑合一) =====
function ConfigDetail({
  config, isBuilder, isAdmin, currentUsername, editing, token, skills, availTools, sbTemplates, models,
  onStartEdit, onCancelEdit, onSaved,
}: {
  config: AgentConfig | null;
  isBuilder: boolean;
  isAdmin: boolean;
  currentUsername: string;
  editing: boolean;
  token: string;
  skills: SkillBrief[];
  availTools: ToolBrief[];
  sbTemplates: SandboxTemplateBrief[];
  models: { id: string; label: string }[];
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  // 编辑权限:builder/admin 且(自己拥有 或 admin)。与后端 routes_agents.py 一致。
  const canEdit = isBuilder && (!config || config.owner_id === currentUsername || isAdmin);

  const [name, setName] = useState(config?.name || "");
  const [prompt, setPrompt] = useState(config?.system_prompt || "");
  const [tools, setTools] = useState<string[]>(config?.tools || []);
  const [skillIds, setSkillIds] = useState<string[]>(config?.skill_ids || []);
  const [sbTemplateId, setSbTemplateId] = useState<string>(config?.sandbox_template_id || "");
  const [model, setModel] = useState(config?.model || "deepseek-v4-flash");
  const [mode, setMode] = useState(config?.mode || "standard");
  const [agentType, setAgentType] = useState(config?.type || "flat");
  const [subagentTypes, setSubagentTypes] = useState<SubagentType[]>(config?.subagent_types || []);
  const [published, setPublished] = useState(config?.is_published || false);

  // config 变化时重置表单(切换不同卡片)
  useEffect(() => {
    setName(config?.name || "");
    setPrompt(config?.system_prompt || "");
    setTools(config?.tools || []);
    setSkillIds(config?.skill_ids || []);
    setSbTemplateId(config?.sandbox_template_id || "");
    setModel(config?.model || "deepseek-v4-flash");
    setMode(config?.mode || "standard");
    setAgentType(config?.type || "flat");
    setSubagentTypes(config?.subagent_types || []);
    setPublished(config?.is_published || false);
  }, [config?.id]);

  const save = async () => {
    const body = {
      name, system_prompt: prompt, tools, skill_ids: skillIds,
      sandbox_template_id: sbTemplateId || null,
      model, mode, type: agentType, subagent_types: subagentTypes,
      is_published: published,
    };
    const url = config ? `${API_BASE}/agents/${config.id}` : `${API_BASE}/agents`;
    const method = config ? "PUT" : "POST";
    const res = await fetch(url, {
      method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (res.ok) { toast("success", "配置已保存"); onSaved(); }
    else { toast("error", `保存失败(${res.status})`); }
  };

  return (
    <>
      <SheetHeader>
        <div className="flex items-center justify-between pr-8">
          <SheetTitle>{editing ? (config ? "编辑配置" : "新建配置") : (config?.name || "配置详情")}</SheetTitle>
          {/* 只读态下可编辑者的编辑入口 */}
          {!editing && canEdit && config && (
            <Button size="sm" variant="outline" onClick={onStartEdit}>
              <PencilIcon className="size-3.5" /> 编辑
            </Button>
          )}
        </div>
        <SheetDescription>
          {config
            ? (editing ? "修改配置,保存后生效" : "查看配置详情")
            : "创建新 Agent 配置"}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-4 overflow-auto px-6 pb-2">
        {/* 名称 */}
        <div>
          <label className="mb-1 block text-sm font-medium">名称</label>
          {editing ? (
            <Input value={name} onChange={e => setName(e.target.value)} disabled={!canEdit} />
          ) : (
            <p className="text-sm">{config?.name}</p>
          )}
        </div>

        {/* System Prompt */}
        <div>
          <label className="mb-1 block text-sm font-medium">System Prompt</label>
          {editing ? (
            <textarea
              className="min-h-32 w-full rounded-md border px-3 py-2 text-sm"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              disabled={!canEdit}
            />
          ) : (
            <pre className="max-h-60 overflow-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
              {config?.system_prompt || "(无)"}
            </pre>
          )}
        </div>

        {/* 模型 + 模式 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">模型</label>
            {editing ? (
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={model} onChange={e => setModel(e.target.value)} disabled={!canEdit}>
                {(models.length ? models : [{ id: model, label: model }]).map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            ) : (
              <p className="text-sm">{config?.model}</p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">防护模式</label>
            {editing ? (
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={mode} onChange={e => setMode(e.target.value)} disabled={!canEdit}>
                <option value="strict">严谨</option>
                <option value="standard">标准</option>
                <option value="yolo">YOLO</option>
              </select>
            ) : (
              <p className="text-sm">{MODE_LABEL[config?.mode || ""] || config?.mode}</p>
            )}
          </div>
        </div>

        {/* Agent 类型(flat 默认;canvas V2 后续段,先禁用) */}
        <div>
          <label className="mb-1 block text-sm font-medium">类型</label>
          {editing ? (
            <select className="w-full rounded-md border px-3 py-2 text-sm" value={agentType} onChange={e => setAgentType(e.target.value)} disabled={!canEdit}>
              <option value="flat">扁平(单 agent 循环)</option>
              <option value="canvas" disabled>画布编排(V2 后续)</option>
            </select>
          ) : (
            <p className="text-sm">{config?.type === "canvas" ? "画布编排" : "扁平"}</p>
          )}
        </div>

        {/* 子代理类型(V2 §4):主 agent 调 task 工具按名 spawn */}
        <div>
          <label className="mb-1 flex items-center justify-between text-sm font-medium">
            <span>子代理类型 <span className="text-xs text-muted-foreground">(主 agent 可委派的命名子任务)</span></span>
            {editing && canEdit && (
              <button type="button" onClick={() => setSubagentTypes([...subagentTypes, { name: "", description: "", prompt: "", tools: [], model: "" }])}
                className="text-xs text-primary hover:underline">+ 添加</button>
            )}
          </label>
          {editing ? (
            <div className="space-y-2">
              {subagentTypes.length === 0 && (
                <p className="text-xs text-muted-foreground">未配置子代理。主 agent 将不能委派子任务。</p>
              )}
              {subagentTypes.map((st, idx) => (
                <div key={idx} className="space-y-1.5 rounded-md border p-2">
                  <div className="flex gap-2">
                    <input className="flex-1 rounded border px-2 py-1 text-sm" placeholder="名称(如 researcher)"
                      value={st.name} disabled={!canEdit}
                      onChange={e => setSubagentTypes(subagentTypes.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))} />
                    {canEdit && (
                      <button type="button" className="shrink-0 text-destructive hover:text-destructive/80" title="删除"
                        onClick={() => setSubagentTypes(subagentTypes.filter((_, i) => i !== idx))}>
                        <TrashIcon className="size-3.5" />
                      </button>
                    )}
                  </div>
                  <input className="w-full rounded border px-2 py-1 text-sm" placeholder="描述(主 agent 据此决定何时委派)"
                    value={st.description} disabled={!canEdit}
                    onChange={e => setSubagentTypes(subagentTypes.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))} />
                  <textarea className="min-h-16 w-full rounded border px-2 py-1 text-xs" placeholder="system prompt"
                    value={st.prompt} disabled={!canEdit}
                    onChange={e => setSubagentTypes(subagentTypes.map((x, i) => i === idx ? { ...x, prompt: e.target.value } : x))} />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground shrink-0">工具(空=继承父)</span>
                    <select className="flex-1 rounded border px-2 py-1 text-xs" value={st.model} disabled={!canEdit}
                      onChange={e => setSubagentTypes(subagentTypes.map((x, i) => i === idx ? { ...x, model: e.target.value } : x))}>
                      <option value="">模型(继承父)</option>
                      {(models.length ? models : [{ id: model, label: model }]).map((m) => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                  {/* 工具复选:沿用父 agent 工具池 */}
                  <div className="flex flex-wrap gap-1.5">
                    {availTools.map(t => {
                      const ref = t.id.startsWith("tool_") ? t.id : t.name;
                      return (
                        <label key={t.id} className="flex items-center gap-1 rounded bg-muted/50 px-1.5 py-0.5 text-xs">
                          <input type="checkbox" checked={st.tools.includes(ref)} disabled={!canEdit}
                            onChange={e => setSubagentTypes(subagentTypes.map((x, i) => i === idx ? {
                              ...x, tools: e.target.checked ? [...x.tools, ref] : x.tools.filter((tt: string) => tt !== ref)
                            } : x))} />
                          {t.name}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {(config?.subagent_types || []).length === 0 ? (
                <span className="text-sm text-muted-foreground">无子代理</span>
              ) : (config?.subagent_types || []).map((st, i) => (
                <span key={i} className="rounded bg-violet-50 px-1.5 py-0.5 text-xs text-violet-700">{st.name || "(未命名)"}</span>
              ))}
            </div>
          )}
        </div>

        {/* 工具 */}
        <div>
          <label className="mb-1 block text-sm font-medium">工具 <span className="text-xs text-muted-foreground">(内置 + 用户工具,见工具管理)</span></label>
          {editing ? (
            <div className="flex max-h-40 flex-col gap-1 overflow-auto rounded-md border p-2">
              {availTools.map(t => {
                // 内置工具按 name 引用,用户工具按 id 引用
                const ref = t.id.startsWith("tool_") ? t.id : t.name;
                return (
                  <label key={t.id} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={tools.includes(ref)} disabled={!canEdit}
                      onChange={e => setTools(e.target.checked ? [...tools, ref] : tools.filter(x => x !== ref))} />
                    <span>{t.name}</span>
                    {t.type !== "builtin" && <span className="rounded bg-muted px-1 text-xs text-muted-foreground">{t.type}</span>}
                    {t.description && <span className="truncate text-xs text-muted-foreground">— {t.description.slice(0, 40)}</span>}
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {config && config.tools.length > 0
                ? config.tools.map(t => {
                    const tl = availTools.find(a => a.id === t || a.name === t);
                    return <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-xs">{tl?.name || t}</span>;
                  })
                : <span className="text-xs text-muted-foreground italic">(无)</span>}
            </div>
          )}
        </div>

        {/* 挂载技能(§4.6 能力包) */}
        {(editing ? skills.length > 0 : (config?.skill_ids.length ?? 0) > 0) && (
          <div>
            <label className="mb-1 block text-sm font-medium">挂载技能 <span className="text-xs text-muted-foreground">(能力包,会话启动时进容器)</span></label>
            {editing ? (
              <div className="space-y-1 rounded-md border p-2">
                {skills.map(s => (
                  <label key={s.id} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={skillIds.includes(s.id)} disabled={!canEdit}
                      onChange={e => setSkillIds(e.target.checked ? [...skillIds, s.id] : skillIds.filter(x => x !== s.id))} />
                    <span>{s.name}</span>
                    {s.description && <span className="text-xs text-muted-foreground">— {s.description.slice(0, 40)}</span>}
                  </label>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {config!.skill_ids.map(id => {
                  const s = skills.find(x => x.id === id);
                  return <span key={id} className="rounded bg-muted px-1.5 py-0.5 text-xs">{s?.name || id}</span>;
                })}
              </div>
            )}
          </div>
        )}

        {/* 沙箱模板(grilling:预置包+硬件配置) */}
        {(editing ? sbTemplates.length > 0 : config?.sandbox_template_id) && (
          <div>
            <label className="mb-1 block text-sm font-medium">沙箱模板 <span className="text-xs text-muted-foreground">(镜像+包+硬件配置)</span></label>
            {editing ? (
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={sbTemplateId} onChange={e => setSbTemplateId(e.target.value)} disabled={!canEdit}>
                <option value="">默认(agent-hub-sandbox)</option>
                {sbTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            ) : (
              <p className="text-sm">
                {config?.sandbox_template_id
                  ? (sbTemplates.find(t => t.id === config.sandbox_template_id)?.name || config.sandbox_template_id)
                  : "默认"}
              </p>
            )}
          </div>
        )}

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
          <Button variant="outline" onClick={onCancelEdit}>取消</Button>
          {canEdit && <Button onClick={save}>保存</Button>}
        </SheetFooter>
      )}
    </>
  );
}
