"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth, API_BASE } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { UploadIcon, TrashIcon, SearchIcon, CheckCircleIcon, FlagIcon } from "lucide-react";

interface KnowledgeDoc {
  id: string;
  filename: string;
  sha256: string;
  status: "processing" | "ready" | "failed";
  error: string;
  review_status: "unreviewed" | "reviewed" | "flagged";
  owner_id: string;
  created_at: string | null;
}

const STATUS_LABEL: Record<string, string> = { processing: "处理中", ready: "就绪", failed: "失败" };
const STATUS_COLOR: Record<string, string> = {
  processing: "bg-amber-50 text-amber-600",
  ready: "bg-green-50 text-green-600",
  failed: "bg-red-50 text-red-600",
};

export default function KnowledgePage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // 检索调试
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<{ text: string; doc_filename: string; score: number }[] | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  const isBuilder = user?.role === "builder" || user?.role === "admin";

  const fetchDocs = async () => {
    if (!user) return;
    setLoadError(null);
    const res = await fetch(`${API_BASE}/knowledge/docs`, { headers: { Authorization: `Bearer ${user.token}` } });
    if (res.ok) { setDocs(await res.json()); }
    else {
      const msg = res.status === 401 ? "登录已过期" : `加载失败(${res.status})`;
      setLoadError(msg);
      if (res.status === 401) { logout(); router.push("/login"); }
    }
  };

  useEffect(() => { fetchDocs(); }, [user]);

  if (loading || !user) return <div className="flex h-screen items-center justify-center text-muted-foreground">加载中...</div>;

  const onUpload = async (file: File) => {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`${API_BASE}/knowledge/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${user.token}` },
        body: fd,
      });
      if (res.ok) {
        const d = await res.json();
        toast("success", d.deduplicated ? "文档已存在(去重)" : "已上传,后台摄入中");
        fetchDocs();
      } else {
        const msg = await res.text().catch(() => "");
        toast("error", `上传失败(${res.status}) ${msg.slice(0, 80)}`);
      }
    } finally {
      setUploading(false);
    }
  };

  const deleteDoc = async (id: string) => {
    if (!confirm("确认删除该文档?关联的所有切块将一并删除。")) return;
    const res = await fetch(`${API_BASE}/knowledge/docs/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${user.token}` } });
    if (res.ok) { toast("success", "已删除"); fetchDocs(); }
    else { toast("error", "删除失败"); }
  };

  const setReview = async (id: string, review_status: "reviewed" | "flagged") => {
    const res = await fetch(`${API_BASE}/knowledge/docs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify({ review_status }),
    });
    if (res.ok) { fetchDocs(); }
    else { toast("error", "标记失败"); }
  };

  const doSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearchResults(null);
    try {
      const res = await fetch(`${API_BASE}/knowledge/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({ query, top_k: 5 }),
      });
      if (res.ok) {
        const d = await res.json();
        setSearchResults(d.results || []);
      } else {
        const msg = await res.text().catch(() => "");
        toast("error", `检索失败(${res.status}) ${msg.slice(0, 80)}`);
      }
    } finally {
      setSearching(false);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">知识库</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              上传团队文档(历史案例/规范/决策记录)→ 自动切块+向量化 → agent 经 search_knowledge 工具检索复用
            </p>
          </div>
          {isBuilder && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.md,.markdown,.pdf,.docx,.xlsx"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) onUpload(f);
                  e.target.value = ""; // 允许重复选同文件
                }}
              />
              <Button size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                <UploadIcon className="size-4" /> {uploading ? "上传中…" : "上传文档"}
              </Button>
            </>
          )}
        </div>

        {/* embedding 源未配提示(有 failed 文档时大概率是此原因) */}
        {docs.some(d => d.status === "failed" && d.error.includes("embedding")) && (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-700">
            ⚠️ 有文档摄入失败,提示"embedding 源未配置"。需运维在网关配置 embedding channel(如 bge-m3),配置后重新上传即可。
          </div>
        )}

        {loadError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">⚠️ {loadError}</div>
        )}

        {/* 文档列表 */}
        {docs.length === 0 && !loadError ? (
          <div className="py-12 text-center text-sm text-muted-foreground">暂无文档,上传一个开始构建知识库</div>
        ) : (
          <div className="space-y-2">
            {docs.map(d => (
              <div key={d.id} className="flex items-center gap-3 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{d.filename}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${STATUS_COLOR[d.status] || "bg-muted text-muted-foreground"}`}>
                      {STATUS_LABEL[d.status] || d.status}
                    </span>
                    {d.review_status === "reviewed" && (
                      <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-600">已复核</span>
                    )}
                    {d.review_status === "flagged" && (
                      <span className="shrink-0 rounded bg-orange-50 px-1.5 py-0.5 text-[11px] text-orange-600">存疑</span>
                    )}
                  </div>
                  {d.status === "failed" && d.error && (
                    <p className="mt-0.5 truncate text-xs text-red-500" title={d.error}>{d.error}</p>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {d.owner_id}{d.created_at && ` · ${new Date(d.created_at).toLocaleString("zh-CN")}`}
                  </p>
                </div>
                {isBuilder && (
                  <div className="flex shrink-0 items-center gap-1">
                    {d.review_status !== "reviewed" && (
                      <Button size="icon-sm" variant="ghost" title="标记已复核" onClick={() => setReview(d.id, "reviewed")}>
                        <CheckCircleIcon className="size-3.5 text-blue-600" />
                      </Button>
                    )}
                    {d.review_status !== "flagged" && (
                      <Button size="icon-sm" variant="ghost" title="标记存疑" onClick={() => setReview(d.id, "flagged")}>
                        <FlagIcon className="size-3.5 text-orange-600" />
                      </Button>
                    )}
                    <Button size="icon-sm" variant="ghost" title="删除" onClick={() => deleteDoc(d.id)}>
                      <TrashIcon className="size-3.5 text-destructive" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 检索调试框(embedding 配好后验证用) */}
        <div className="mt-8">
          <h2 className="mb-2 text-sm font-medium">检索测试(embedding 配置后可用)</h2>
          <div className="flex gap-2">
            <Input
              placeholder="输入检索问题…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && doSearch()}
              className="flex-1"
            />
            <Button size="sm" disabled={searching || !query.trim()} onClick={doSearch}>
              <SearchIcon className="size-3.5" /> {searching ? "检索中…" : "检索"}
            </Button>
          </div>
          {searchResults && (
            <div className="mt-3 space-y-2">
              {searchResults.length === 0 ? (
                <p className="text-sm text-muted-foreground">无匹配结果</p>
              ) : searchResults.map((r, i) => (
                <div key={i} className="rounded-md border bg-muted/30 p-2.5 text-xs">
                  <div className="mb-1 flex items-center justify-between text-muted-foreground">
                    <span>{r.doc_filename}</span>
                    <span>相似度 {r.score}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-foreground">{r.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
