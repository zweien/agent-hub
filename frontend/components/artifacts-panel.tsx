"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { API_BASE } from "@/contexts/auth-context";
import { DownloadIcon, FileIcon, ImageIcon, PackageIcon, PanelRightCloseIcon, RefreshCwIcon } from "lucide-react";

interface Artifact {
  name: string;
  size: number;
  mtime: number;
  type: string;
}

const IMAGE_TYPES = ["png", "jpg", "jpeg", "gif", "webp", "svg"];
const CAD_TYPES = ["step", "stp", "stl", "3mf", "glb", "gltf", "obj"];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function TypeIcon({ type }: { type: string }) {
  if (IMAGE_TYPES.includes(type)) return <ImageIcon className="size-3.5 text-blue-500" />;
  if (CAD_TYPES.includes(type)) return <PackageIcon className="size-3.5 text-purple-500" />;
  return <FileIcon className="size-3.5 text-muted-foreground" />;
}

function typeLabel(type: string): string {
  if (IMAGE_TYPES.includes(type)) return "图片";
  if (CAD_TYPES.includes(type)) return "CAD";
  return type || "文件";
}

export function ArtifactsPanel({ sessionId, token, refreshKey, onCollapse }: {
  sessionId: string | null;
  token: string;
  refreshKey?: number;
  onCollapse?: () => void;
}) {
  const [items, setItems] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchArtifacts = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}/artifacts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        if (res.status === 401) { setError("登录已过期"); return; }
        if (res.status === 404) { setItems([]); setError(null); return; } // 容器未运行
        setError(`加载失败(${res.status})`);
        return;
      }
      setItems(await res.json());
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }, [sessionId, token]);

  // sessionId 变化 + refreshKey 变化时拉取
  useEffect(() => {
    fetchArtifacts();
  }, [fetchArtifacts, refreshKey]);

  // 轮询(5s,容器运行时自动刷新新产物)
  useEffect(() => {
    if (!sessionId) return;
    const t = setInterval(fetchArtifacts, 5000);
    return () => clearInterval(t);
  }, [fetchArtifacts, sessionId]);

  const downloadUrl = (name: string) =>
    `${API_BASE}/sessions/${sessionId}/artifacts/${encodeURIComponent(name)}?token=${encodeURIComponent(token)}`;
  const previewUrl = (name: string) =>
    `${API_BASE}/sessions/${sessionId}/artifacts/${encodeURIComponent(name)}?token=${encodeURIComponent(token)}`;

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l bg-background">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-1.5">
          <PackageIcon className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">产物</span>
          {items.length > 0 && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{items.length}</span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <Button size="icon-sm" variant="ghost" onClick={fetchArtifacts} disabled={loading} title="刷新">
            <RefreshCwIcon className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          {onCollapse && (
            <Button size="icon-sm" variant="ghost" onClick={onCollapse} title="收起产物面板">
              <PanelRightCloseIcon className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-2">
        {!sessionId && (
          <div className="py-8 text-center text-xs text-muted-foreground">开始对话后显示产物</div>
        )}
        {sessionId && !error && items.length === 0 && !loading && (
          <div className="py-8 text-center text-xs text-muted-foreground">暂无产物</div>
        )}
        {error && (
          <div className="py-4 text-center text-xs text-red-500">{error}</div>
        )}
        <div className="space-y-2">
          {items.map((a) => (
            <div key={a.name} className="rounded-lg border p-2">
              <div className="flex items-start gap-2">
                <div className="mt-0.5 shrink-0">
                  <TypeIcon type={a.type} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs font-medium" title={a.name}>{a.name}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="rounded bg-muted px-1 py-0.5">{typeLabel(a.type)}</span>
                    <span>{formatSize(a.size)}</span>
                  </div>
                </div>
              </div>
              {/* 图片类型:缩略图 */}
              {IMAGE_TYPES.includes(a.type) && (
                <a href={previewUrl(a.name)} target="_blank" rel="noreferrer" className="mt-2 block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl(a.name)}
                    alt={a.name}
                    className="w-full rounded border bg-muted/30"
                    loading="lazy"
                  />
                </a>
              )}
              {/* 下载按钮 */}
              <a href={downloadUrl(a.name)} download={a.name} className="mt-2 block">
                <Button size="sm" variant="outline" className="w-full">
                  <DownloadIcon className="size-3" /> 下载
                </Button>
              </a>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
