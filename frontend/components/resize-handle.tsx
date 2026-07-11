"use client";

import { useCallback, useRef, useState } from "react";

/**
 * 竖向拖拽手柄:挂在某列的左/右边缘,拖动调该列宽度。
 *
 * side="right":手柄在该列右边缘,鼠标右拖(delta>0)→ 列变宽
 * side="left" :手柄在该列左边缘,内部翻转 → 鼠标左拖时列变宽
 *
 * onResize(deltaPx):每 pointermove 调一次,delta 已按 side 翻转好(正=加宽)。
 *   父组件拿到后 clamp + setState。
 * onMin():向"缩小"方向连续拖动超过 32px(累计)时触发一次,用于自动折叠。
 *   一次拖拽只触发一次,避免反复折叠/展开抖动。
 *
 * 用法:父容器需 relative;手柄 absolute 贴边,2px 宽,hover/active 变蓝 + col-resize。
 */
export function ResizeHandle({
  side,
  onResize,
  onMin,
}: {
  side: "left" | "right";
  onResize: (deltaPx: number) => void;
  onMin?: () => void;
}) {
  const startX = useRef<number | null>(null);
  const shrinkAccum = useRef(0); // 累计向"缩小"方向的拖动量,达阈值触发 onMin
  const minFired = useRef(false);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    startX.current = e.clientX;
    shrinkAccum.current = 0;
    minFired.current = false;
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (startX.current === null) return;
    const raw = e.clientX - startX.current;
    // left 手柄:鼠标左移(raw<0)应加宽 → 翻转
    const delta = side === "right" ? raw : -raw;
    startX.current = e.clientX; // 增量式:每次只传自上一帧的位移
    onResize(delta);
    // 向缩小方向累计(delta<0 即缩小)。超 32px 且只触发一次 → onMin。
    if (delta < 0 && onMin && !minFired.current) {
      shrinkAccum.current += -delta;
      if (shrinkAccum.current > 32) {
        minFired.current = true;
        onMin();
      }
    }
  }, [side, onResize, onMin]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    startX.current = null;
    setDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={`absolute top-0 z-20 h-full w-1 cursor-col-resize touch-none ${
        side === "right" ? "right-0 -mr-0.5" : "left-0 -ml-0.5"
      } ${dragging ? "bg-primary/60" : "bg-transparent hover:bg-primary/40"}`}
    />
  );
}
