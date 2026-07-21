"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls,
  useNodesState, useEdgesState, addEdge,
  type Node, type Edge, type Connection, type NodeProps,
  Handle, Position, MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { XIcon, PlusIcon } from "lucide-react";

/**
 * 画布编排编辑器(V2 §5)。全屏 overlay,ReactFlow 画布。
 * 5 种节点:entry / exit / llm / tool / subagent / condition。
 * 输出 canvas_def JSON:{nodes, edges, entry_node_id},回传父组件保存。
 */

export type CanvasNodeType = "entry" | "exit" | "llm" | "tool" | "subagent" | "condition" | "hitl" | "loop" | "parallel";

interface CanvasNodeData {
  // 通用
  label?: string;
  // llm
  prompt?: string;
  model?: string;
  // tool
  tool_name?: string;
  // subagent
  subagent_type?: string;
  // condition
  rules?: { handle: string; contains?: string; target: string }[];
  // loop
  loop_target?: string;
  exit_keyword?: string;
  // parallel
  branches?: string[];  // join 分支源节点 id 列表
  join_target?: string;  // 显式 join 目标
  [key: string]: unknown;
}

const NODE_META: Record<CanvasNodeType, { label: string; color: string; desc: string }> = {
  entry: { label: "入口", color: "border-green-400 bg-green-50", desc: "图开始(接 START)" },
  exit: { label: "出口", color: "border-red-400 bg-red-50", desc: "图结束(接 END)" },
  llm: { label: "LLM", color: "border-blue-400 bg-blue-50", desc: "调 LLM 生成回复" },
  tool: { label: "工具", color: "border-amber-400 bg-amber-50", desc: "调内置工具" },
  subagent: { label: "子代理", color: "border-violet-400 bg-violet-50", desc: "委派子代理" },
  condition: { label: "条件", color: "border-orange-400 bg-orange-50", desc: "按消息内容分支" },
  hitl: { label: "人工输入", color: "border-pink-400 bg-pink-50", desc: "暂停等用户输入(Resume)" },
  loop: { label: "循环", color: "border-cyan-400 bg-cyan-50", desc: "按条件回环或前进" },
  parallel: { label: "并行", color: "border-teal-400 bg-teal-50", desc: "出边全部并发(Send)" },
};

let _nodeSeq = 0;
const newNodeId = (t: CanvasNodeType) => `${t}_${Date.now().toString(36)}_${++_nodeSeq}`;

// —— 自定义节点渲染 ——
function CanvasNode({ id, data, type, selected }: NodeProps) {
  const ntype = (type as CanvasNodeType) || "llm";
  const meta = NODE_META[ntype];
  const d = data as CanvasNodeData;
  return (
    <div className={`min-w-[140px] rounded-md border-2 px-3 py-2 text-xs shadow-sm ${meta.color} ${selected ? "ring-2 ring-primary" : ""}`}>
      {/* 入口节点只显示输出 handle;出口只显示输入;其余两端都有 */}
      {ntype !== "entry" && <Handle type="target" position={Position.Left} />}
      <div className="font-semibold">{meta.label}</div>
      <div className="mt-0.5 max-w-[160px] truncate text-muted-foreground">
        {ntype === "llm" && (d.prompt?.slice(0, 30) || "(无 prompt)")}
        {ntype === "tool" && (d.tool_name || "(未选工具)")}
        {ntype === "subagent" && (d.subagent_type || "(未选子代理)")}
        {ntype === "condition" && `${d.rules?.length || 0} 条规则`}
        {ntype === "hitl" && (d.prompt?.slice(0, 30) || "暂停等输入")}
        {ntype === "loop" && (d.loop_target ? `回到 ${d.loop_target}` : "回环节点")}
        {ntype === "parallel" && `${d.branches?.length || 0} 路并发`}
        {ntype === "entry" && "START"}
        {ntype === "exit" && "END"}
      </div>
      {ntype !== "exit" && <Handle type="source" position={Position.Right} />}
      {/* condition 多个输出 handle(按 rule handle 名) */}
      {ntype === "condition" && (d.rules || []).map((r, i) => (
        <div key={i} className="mt-1 flex items-center gap-1 text-[10px]">
          <span className="rounded bg-white/70 px-1">{r.handle}:</span>
          <span className="truncate text-muted-foreground">{r.contains || "默认"}</span>
        </div>
      ))}
    </div>
  );
}

const nodeTypes = { entry: CanvasNode, exit: CanvasNode, llm: CanvasNode, tool: CanvasNode, subagent: CanvasNode, condition: CanvasNode, hitl: CanvasNode, loop: CanvasNode, parallel: CanvasNode };

// —— 节点参数面板(右侧,选中节点时显示) ——
function NodeInspector({ node, onChange }: { node: Node<CanvasNodeData> | null; onChange: (id: string, data: Partial<CanvasNodeData>) => void }) {
  if (!node) return <div className="p-4 text-sm text-muted-foreground">点选一个节点编辑参数</div>;
  const d = node.data;
  const ntype = node.type as CanvasNodeType;
  return (
    <div className="space-y-3 p-4">
      <div className="text-sm font-medium">{NODE_META[ntype].label} 节点参数</div>
      {ntype === "llm" && (
        <>
          <div>
            <label className="mb-1 block text-xs font-medium">System Prompt</label>
            <Textarea className="min-h-24 text-xs" value={d.prompt || ""} onChange={e => onChange(node.id, { prompt: e.target.value })} placeholder="你是…" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">模型(空=继承父 agent)</label>
            <Input className="text-xs" value={d.model || ""} onChange={e => onChange(node.id, { model: e.target.value })} placeholder="deepseek-v4-flash" />
          </div>
        </>
      )}
      {ntype === "tool" && (
        <div>
          <label className="mb-1 block text-xs font-medium">工具名(内置,如 run_aero_tool / search_knowledge)</label>
          <Input className="text-xs" value={d.tool_name || ""} onChange={e => onChange(node.id, { tool_name: e.target.value })} placeholder="run_aero_tool" />
        </div>
      )}
      {ntype === "subagent" && (
        <div>
          <label className="mb-1 block text-xs font-medium">子代理类型名(在 subagent_types 中定义)</label>
          <Input className="text-xs" value={d.subagent_type || ""} onChange={e => onChange(node.id, { subagent_type: e.target.value })} placeholder="researcher" />
        </div>
      )}
      {ntype === "condition" && (
        <div>
          <label className="mb-1 block text-xs font-medium">分支规则</label>
          <p className="mb-2 text-[11px] text-muted-foreground">每条规则:handle(出口标签)+ contains(消息含此词走此出口,空=默认)。连边时 source_handle 要与 handle 名一致。</p>
          <div className="space-y-2">
            {(d.rules || []).map((r, i) => (
              <div key={i} className="flex gap-1">
                <Input className="w-20 text-xs" placeholder="handle" value={r.handle} onChange={e => {
                  const rules = [...(d.rules || [])]; rules[i] = { ...rules[i], handle: e.target.value }; onChange(node.id, { rules });
                }} />
                <Input className="flex-1 text-xs" placeholder="包含关键词(空=默认)" value={r.contains || ""} onChange={e => {
                  const rules = [...(d.rules || [])]; rules[i] = { ...rules[i], contains: e.target.value }; onChange(node.id, { rules });
                }} />
                <Button size="icon-sm" variant="ghost" onClick={() => onChange(node.id, { rules: (d.rules || []).filter((_, j) => j !== i) })}>
                  <XIcon className="size-3" />
                </Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => onChange(node.id, { rules: [...(d.rules || []), { handle: `分支${(d.rules?.length || 0) + 1}`, contains: "", target: "" }] })}>
              <PlusIcon className="size-3" /> 加规则
            </Button>
          </div>
        </div>
      )}
      {ntype === "entry" && <p className="text-xs text-muted-foreground">入口节点无参数。它会接 START,作为图执行的起点。</p>}
      {ntype === "exit" && <p className="text-xs text-muted-foreground">出口节点无参数。它接 END,结束图执行。</p>}
      {ntype === "hitl" && (
        <div>
          <label className="mb-1 block text-xs font-medium">提示语(暂停时展示给用户)</label>
          <Textarea className="min-h-16 text-xs" value={d.prompt || ""} onChange={e => onChange(node.id, { prompt: e.target.value })} placeholder="请确认以上方案,或输入修改意见…" />
          <p className="mt-1.5 text-[11px] text-muted-foreground">执行到此节点时暂停,用户在对话框输入后点提交触发 Resume,图继续(输入作为新消息回流)。</p>
        </div>
      )}
      {ntype === "loop" && (
        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-xs font-medium">循环目标节点 id(回到哪个节点)</label>
            <Input className="text-xs" value={d.loop_target || ""} onChange={e => onChange(node.id, { loop_target: e.target.value })} placeholder="如 n2(画布上某节点 id)" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">退出关键词(最后消息含此词则退出循环,空=永不退出靠出边)</label>
            <Input className="text-xs" value={d.exit_keyword || ""} onChange={e => onChange(node.id, { exit_keyword: e.target.value })} placeholder="如 完成" />
          </div>
          <p className="text-[11px] text-muted-foreground">出边:一条连回 loop_target(继续),另一条连退出目标(前进)。注意递归上限默认 10007,超长循环会熔断。</p>
        </div>
      )}
      {ntype === "parallel" && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">出边全部并发执行(Send fan-out),每个分支拿到完整 state。分支各自往下走,state 自动合并。</p>
          <div>
            <label className="mb-1 block text-xs font-medium">显式 join 目标(可选,分支需在某节点前同步时填)</label>
            <Input className="text-xs" value={d.join_target || ""} onChange={e => onChange(node.id, { join_target: e.target.value })} placeholder="汇聚节点 id(留空=分支独立)" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">join 分支源节点 id 列表(逗号分隔,与 join_target 配合)</label>
            <Input className="text-xs" value={(d.branches || []).join(",")} onChange={e => onChange(node.id, { branches: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} placeholder="如 n2, n3" />
          </div>
        </div>
      )}
    </div>
  );
}

// —— 内部:受 ReactFlowProvider 包裹的画布 ——
function CanvasInner({ canvasDef, onChange }: { canvasDef: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void }) {
  // 从 canvas_def 初始化(若有)。ReactFlow v12 要求每个 node 有 position,缺失时给默认。
  const rawNodes = (canvasDef.nodes as Node<CanvasNodeData>[]) || [];
  const initNodes = rawNodes.map((n, i) => ({
    ...n,
    position: n.position || { x: 250 + (i % 3) * 200, y: 80 + Math.floor(i / 3) * 120 },
    data: n.data || {},
  }));
  const initEdges = (canvasDef.edges as Edge[]) || [];
  const initEntry = (canvasDef.entry_node_id as string) || "";

  const [nodes, setNodes, onNodesChange] = useNodesState(initNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges);
  const [entryId, setEntryId] = useState(initEntry);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedNode = useMemo(() => nodes.find(n => n.id === selectedId) || null, [nodes, selectedId]);

  const onConnect = useCallback((c: Connection) => {
    setEdges(eds => addEdge({ ...c, markerEnd: { type: MarkerType.ArrowClosed } }, eds));
  }, [setEdges]);

  const addNode = (t: CanvasNodeType) => {
    const id = newNodeId(t);
    const data: CanvasNodeData = t === "condition" ? { rules: [] } : {};
    const newNode: Node<CanvasNodeData> = {
      id, type: t, position: { x: 250 + Math.random() * 200, y: 80 + nodes.length * 100 },
      data,
    };
    setNodes(ns => [...ns, newNode]);
    // 第一个 entry 节点自动设为入口
    if (t === "entry" && !entryId) setEntryId(id);
    if (t === "entry") setSelectedId(id);
  };

  const updateNodeData = (id: string, patch: Partial<CanvasNodeData>) => {
    setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));
  };

  const setEntry = (id: string) => {
    const n = nodes.find(x => x.id === id);
    if (n?.type === "entry") { setEntryId(id); }
  };

  // 每次状态变化都同步回父组件(关闭即保存,父 state 始终最新)。
  // useEffect 跟踪 nodes/edges/entryId;React 批处理避免高频写库。
  useEffect(() => {
    onChange({ nodes, edges, entry_node_id: entryId });
  }, [nodes, edges, entryId, onChange]);

  return (
    <div className="flex h-full">
      {/* 左:节点面板 */}
      <div className="w-32 shrink-0 space-y-1 border-r p-2">
        <div className="mb-1 text-xs font-medium text-muted-foreground">拖入 / 点加</div>
        {(Object.keys(NODE_META) as CanvasNodeType[]).map(t => (
          <button key={t} onClick={() => addNode(t)} className="w-full rounded border bg-background px-2 py-1.5 text-left text-xs hover:bg-accent">
            <span className={`inline-block size-2 rounded-full border ${NODE_META[t].color.split(" ").find(c => c.startsWith("border-")) || ""} mr-1`} />
            {NODE_META[t].label}
          </button>
        ))}
      </div>
      {/* 中:画布 */}
      <div className="relative min-h-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          onNodeClick={(_, n) => setSelectedId(n.id)}
          onNodeDoubleClick={(_, n) => { if (n.type === "entry") setEntry(n.id); }}
          fitView
          className="h-full w-full bg-muted/20"
          style={{ height: "100%" }}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
        </ReactFlow>
        {/* 入口标记 */}
        <div className="absolute left-2 top-2 rounded bg-background/80 px-2 py-1 text-[11px] text-muted-foreground">
          入口:{entryId || "(双击 entry 节点设为入口)"}
        </div>
      </div>
      {/* 右:参数面板 */}
      <div className="w-72 shrink-0 overflow-auto border-l">
        <NodeInspector node={selectedNode} onChange={updateNodeData} />
      </div>
    </div>
  );
}

export function CanvasEditor({
  open, onOpenChange, canvasDef, onChange, canEdit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  canvasDef: Record<string, unknown>;
  onChange: (d: Record<string, unknown>) => void;
  canEdit: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] w-[95vw] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="flex-row items-center justify-between border-b py-3 pl-4 pr-12">
          <DialogTitle className="text-sm">画布编排编辑器</DialogTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => { /* save 触发在 inner;这里仅关闭 */ onOpenChange(false); }} disabled={!canEdit}>
              保存并关闭
            </Button>
          </div>
        </DialogHeader>
        <p className="border-b bg-muted/30 px-4 py-1.5 text-[11px] text-muted-foreground">
          节点:入口/出口/LLM/工具/子代理/条件。点左侧加节点 → 连线 → 右侧编辑参数 → 关闭时自动保存。
          condition 节点的连边 source_handle 要与规则 handle 一致。
        </p>
        <div className="min-h-0 flex-1">
          <ReactFlowProvider>
            {/* CanvasInner 内部 onNodesChange 等会触发重渲染,save 逻辑在关闭时序列化 */}
            <CanvasInnerWithSave canvasDef={canvasDef} onChange={onChange} onClose={() => onOpenChange(false)} />
          </ReactFlowProvider>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// 包装:关闭前把最新 nodes/edges 序列化回 onChange
function CanvasInnerWithSave({ canvasDef, onChange, onClose }: { canvasDef: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void; onClose: () => void }) {
  // 用一个 ref 桥接:CanvasInner 每次 onChange 都更新外层 canvasDef,关闭时已是最新
  return <CanvasInner canvasDef={canvasDef} onChange={(d) => { onChange(d); }} />;
}
