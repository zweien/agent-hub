"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, API_BASE } from "@/contexts/auth-context";
import { Sidebar } from "@/components/sidebar";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon, TrashIcon, ExternalLinkIcon } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import Link from "next/link";

interface Sandbox {
  session_id: string;
  container_name: string;
  container_id: string;
  port: number | null;
  sandbox_url: string;
  owner: string | null;
  title: string | null;
  status: string;
  idle_seconds: number | null;
  task_running: boolean;
  in_registry: boolean;
}

function fmtDuration(s: number): string {
  if (s < 60) return `${s}秒`;
  if (s < 3600) return `${Math.floor(s / 60)}分钟`;
  return `${Math.floor(s / 3600)}小时${Math.floor((s % 3600) / 60)}分`;
}

export default function SandboxesPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [sandboxes, setSandboxes] = useState<Sandbox[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && (!user || user.role !== "admin")) router.push("/login");
  }, [user, loading, router]);

  const fetchSandboxes = async () => {
    if (!user) return;
    setLoadError(null);
    const res = await fetch(`${API_BASE}/sandboxes`, { headers: { Authorization: `Bearer ${user.token}` } });
    if (res.ok) { setSandboxes(await res.json()); }
    else { setLoadError(`加载失败(${res.status})`); }
  };
  useEffect(() => { fetchSandboxes(); const t = setInterval(fetchSandboxes, 5000); return () => clearInterval(t); }, [user]);

  const release = async (sid: string) => {
    if (!confirm(`确认回收会话 ${sid.slice(0, 16)}... 的沙箱?`)) return;
    const res = await fetch(`${API_BASE}/sandboxes/${sid}`, { method: "DELETE", headers: { Authorization: `Bearer ${user!.token}` } });
    if (res.ok) { toast("success", "沙箱已回收"); fetchSandboxes(); }
    else { toast("error", "回收失败"); }
  };

  if (loading || !user || user.role !== "admin") return <div className="flex h-screen items-center justify-center text-muted-foreground">需要管理员权限</div>;

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl p-6">
          <div className="mb-6 flex items-center gap-3">
            <Link href="/" className="text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-5" /></Link>
            <h1 className="text-xl font-semibold">沙箱管理</h1>
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{sandboxes.length} 个活跃</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">每5秒刷新</span>
          </div>

          {loadError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">⚠️ {loadError}</div>}

          <div className="space-y-3">
            {sandboxes.length === 0 && !loadError && <div className="text-sm text-muted-foreground">当前无活跃沙箱(对话时自动创建)</div>}
            {sandboxes.map((s) => (
              <div key={s.session_id} className="rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono font-medium">{s.container_name}</span>
                      {s.task_running
                        ? <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">运行中</span>
                        : <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">空闲</span>}
                      {!s.in_registry && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-600" title="后端重启后遗留的容器,内存无记录">孤儿</span>}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      会话 {s.session_id.slice(0, 20)} · {s.title || "(无标题)"} · 用户 {s.owner || "?"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      端口 {s.port ?? "?"} · {s.idle_seconds != null ? `空闲 ${fmtDuration(s.idle_seconds)}` : "无活跃记录"} · 状态 {s.status}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="outline"
                      disabled={!s.sandbox_url}
                      onClick={() => s.sandbox_url && window.open(s.sandbox_url, "_blank", "noopener,noreferrer")}>
                      <ExternalLinkIcon className="size-3.5" /> 打开
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => release(s.session_id)}><TrashIcon className="size-3.5 text-destructive" /></Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
