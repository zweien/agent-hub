"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { API_BASE } from "@/contexts/auth-context";
import {
  FileTree, FileTreeFile, FileTreeFolder, FileTreeIcon, FileTreeName, FileTreeActions,
} from "@/components/ai-elements/file-tree";
import {
  DownloadIcon, FileIcon, ImageIcon, PackageIcon, PanelRightCloseIcon, RefreshCwIcon, MaximizeIcon,
} from "lucide-react";

// model-viewer 是 web component,import 即注册 <model-viewer> 自定义元素(副作用)。
// SSR 不识别自定义元素,故动态加载(仅客户端)。返回 null——元素直接在 JSX 里用。
const ModelViewerLoader = dynamic(
  () => import("@google/model-viewer").then(() => () => null),
  { ssr: false },
);

interface Artifact {
  name: string;      // 相对 /workspace 的路径,可能含子目录(如 "out/wing.step")
  size: number;
  mtime: number;
  type: string;
}

const IMAGE_TYPES = ["png", "jpg", "jpeg", "gif", "webp", "svg"];
const CAD_TYPES = ["step", "stp", "stl", "3mf", "glb", "gltf", "obj"];
// 需转 GLB 才能预览的类型(STEP/STP);STL/GLB/GLTF/OBJ model-viewer 可直接渲染
const STEP_TYPES = ["step", "stp"];
const MESH_TYPES = ["stl", "glb", "gltf", "obj"];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function TypeIcon({ type }: { type: string }) {
  if (IMAGE_TYPES.includes(type)) return <ImageIcon className="size-4 text-blue-500" />;
  if (CAD_TYPES.includes(type)) return <PackageIcon className="size-4 text-purple-500" />;
  return <FileIcon className="size-4 text-muted-foreground" />;
}

// —— flat 路径列表 → 嵌套树(FileTreeFolder/FileTreeFile 的声明式结构)——
interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  artifact?: Artifact;       // 文件节点挂原始 artifact
  children: Map<string, TreeNode>;
}

function buildTree(items: Artifact[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isDir: true, children: new Map() };
  for (const a of items) {
    const segs = a.name.split("/").filter(Boolean);
    let cur = root;
    segs.forEach((seg, i) => {
      const isLast = i === segs.length - 1;
      const childPath = segs.slice(0, i + 1).join("/");
      let node = cur.children.get(seg);
      if (!node) {
        node = { name: seg, path: childPath, isDir: !isLast, children: new Map() };
        cur.children.set(seg, node);
      }
      if (isLast) { node.isDir = false; node.artifact = a; }
      cur = node;
    });
  }
  // 目录优先,再按名字排序;文件按 mtime 已由后端排好(list 是 mtime desc),
  // 但树内同级重组后失去顺序,这里按 name 排序保证稳定。
  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    const arr = [...nodes.values()].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;  // 目录在前
      return a.name.localeCompare(b.name);
    });
    for (const n of arr) if (n.isDir) sortNodes([...n.children.values()]);
    return arr;
  };
  return sortNodes([...root.children.values()]);
}

// 递归渲染树节点
function renderNodes(nodes: TreeNode[], downloadUrl: (n: string) => string): React.ReactNode {
  return nodes.map((n) => {
    if (n.isDir) {
      return (
        <FileTreeFolder key={n.path} name={n.name} path={n.path}>
          {renderNodes([...n.children.values()], downloadUrl)}
        </FileTreeFolder>
      );
    }
    const a = n.artifact!;
    return (
      <FileTreeFile key={n.path} path={n.path} name={n.name} icon={<TypeIcon type={a.type} />}>
        <FileTreeIcon><TypeIcon type={a.type} /></FileTreeIcon>
        <FileTreeName>{n.name}</FileTreeName>
        <span className="ml-1 text-[10px] text-muted-foreground/70">{formatSize(a.size)}</span>
        <FileTreeActions>
          <a href={downloadUrl(n.path)} download={n.name} title="下载" className="text-muted-foreground hover:text-foreground">
            <DownloadIcon className="size-3.5" />
          </a>
        </FileTreeActions>
      </FileTreeFile>
    );
  });
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
  // 选中预览(图片类 inline 预览)
  const [selected, setSelected] = useState<string | null>(null);
  // 全屏 3D 查看器(点"全屏"按钮打开)
  const [fullscreen, setFullscreen] = useState(false);

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

  useEffect(() => { fetchArtifacts(); }, [fetchArtifacts, refreshKey]);
  useEffect(() => {
    if (!sessionId) return;
    const t = setInterval(fetchArtifacts, 5000);
    return () => clearInterval(t);
  }, [fetchArtifacts, sessionId]);

  const downloadUrl = (name: string) =>
    `${API_BASE}/sessions/${sessionId}/artifacts/${encodeURIComponent(name)}?token=${encodeURIComponent(token)}`;
  // model-viewer 加载 URL:STEP/STP 走 ?convert=glb(后端容器转 GLB),其余 mesh 类型直给
  const viewerUrl = (name: string, type: string) =>
    STEP_TYPES.includes(type)
      ? `${API_BASE}/sessions/${sessionId}/artifacts/${encodeURIComponent(name)}?token=${encodeURIComponent(token)}&convert=glb`
      : downloadUrl(name);

  const tree = useMemo(() => buildTree(items), [items]);
  const selectedArtifact = items.find((a) => a.name === selected);
  const is3D = selectedArtifact && (STEP_TYPES.includes(selectedArtifact.type) || MESH_TYPES.includes(selectedArtifact.type));

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
        {items.length > 0 && (
          <FileTree
            onSelect={(p) => setSelected(p)}
            selectedPath={selected || undefined}
            className="text-sm"
          >
            {renderNodes(tree, downloadUrl)}
          </FileTree>
        )}
      </div>

      {/* 选中文件的预览区:图片 inline / 3D 交互(STEP 转GLB 或 mesh 直渲)/ 其余下载 */}
      {selectedArtifact && (
        <div className="border-t p-2">
          <div className="mb-1 flex items-center gap-1.5">
            <TypeIcon type={selectedArtifact.type} />
            <span className="truncate font-mono text-xs" title={selectedArtifact.name}>{selectedArtifact.name}</span>
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">{formatSize(selectedArtifact.size)}</span>
            {/* 3D 文件:全屏查看按钮 */}
            {is3D && (
              <Button size="icon-sm" variant="ghost" className="size-6 shrink-0" title="全屏查看 3D" onClick={() => setFullscreen(true)}>
                <MaximizeIcon className="size-3.5" />
              </Button>
            )}
          </div>
          {IMAGE_TYPES.includes(selectedArtifact.type) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={downloadUrl(selectedArtifact.name)}
              alt={selectedArtifact.name}
              className="w-full rounded border bg-muted/30"
              loading="lazy"
            />
          ) : is3D ? (
            <>
              <ModelViewerLoader />
              {/* @ts-expect-error model-viewer 是 web component,无 TS 类型 */}
              <model-viewer
                src={viewerUrl(selectedArtifact.name, selectedArtifact.type)}
                alt={selectedArtifact.name}
                camera-controls
                auto-rotate
                rotation-per-second="30deg"
                shadow-intensity="1"
                environment-image="neutral"
                class="h-56 w-full rounded border bg-gradient-to-b from-muted/40 to-background"
              />
              <div className="mt-1 text-center text-[10px] text-muted-foreground/70">
                {STEP_TYPES.includes(selectedArtifact.type) ? "STEP→GLB 按需转换(首次稍候)" : "拖拽旋转 · 滚轮缩放"}
              </div>
            </>
          ) : (
            <a href={downloadUrl(selectedArtifact.name)} download={selectedArtifact.name}>
              <Button size="sm" variant="outline" className="w-full">
                <DownloadIcon className="size-3" /> 下载 {formatSize(selectedArtifact.size)}
              </Button>
            </a>
          )}
        </div>
      )}

      {/* 全屏 3D 查看器:点"全屏"按钮打开,接近全屏的 model-viewer + 下载 */}
      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="flex h-[90vh] max-w-5xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="flex-row items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <TypeIcon type={selectedArtifact?.type || ""} />
              <DialogTitle className="font-mono text-sm">{selectedArtifact?.name}</DialogTitle>
              {selectedArtifact && (
                <span className="text-xs text-muted-foreground/70">{formatSize(selectedArtifact.size)}</span>
              )}
            </div>
            {selectedArtifact && (
              <a href={downloadUrl(selectedArtifact.name)} download={selectedArtifact.name}>
                <Button size="sm" variant="outline">
                  <DownloadIcon className="size-3.5" /> 下载
                </Button>
              </a>
            )}
            <DialogDescription className="sr-only">3D 模型全屏预览</DialogDescription>
          </DialogHeader>
          {/* 全屏 model-viewer:撑满剩余空间,暗色背景突出模型 */}
          {selectedArtifact && (
            <>
              <ModelViewerLoader />
              {/* @ts-expect-error model-viewer 是 web component,无 TS 类型 */}
              <model-viewer
                src={viewerUrl(selectedArtifact.name, selectedArtifact.type)}
                alt={selectedArtifact.name}
                camera-controls
                auto-rotate
                rotation-per-second="20deg"
                shadow-intensity="1"
                environment-image="neutral"
                class="h-full w-full bg-zinc-900"
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </aside>
  );
}
