"use client";

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";

// 可调宽区域的边界约束(px)。导出供组件 clamp 用。
export const SIDEBAR_MIN = 64;
export const SIDEBAR_MAX = 400;
export const CONV_MIN = 192;
export const CONV_MAX = 480;
export const ART_MIN = 240;
export const ART_MAX = 640;

interface UIContextValue {
  sidebarCollapsed: boolean;
  artifactsCollapsed: boolean;
  conversationsCollapsed: boolean;
  // 三栏宽度(px,展开态用;折叠态走固定 w-12/w-16)
  sidebarWidth: number;
  conversationsWidth: number;
  artifactsWidth: number;
  toggleSidebar: () => void;
  toggleArtifacts: () => void;
  toggleConversations: () => void;
  setSidebarWidth: (n: number) => void;
  setConversationsWidth: (n: number) => void;
  setArtifactsWidth: (n: number) => void;
}

const UIContext = createContext<UIContextValue | null>(null);

const STORAGE_KEY = "agenthub_ui";

interface StoredUI {
  sidebarCollapsed?: boolean;
  artifactsCollapsed?: boolean;
  conversationsCollapsed?: boolean;
  sidebarWidth?: number;
  conversationsWidth?: number;
  artifactsWidth?: number;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function UIProvider({ children }: { children: ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [artifactsCollapsed, setArtifactsCollapsed] = useState(false);
  // 对话列表默认折叠(w-12 rail);对话页四栏布局(主侧栏+本面板+消息+产物),
  // 默认展开会挤占消息区,故默认收起,用户按需展开。
  const [conversationsCollapsed, setConversationsCollapsed] = useState(true);
  // 三栏宽度默认值(= 原 Tailwind w-64/w-64/w-72 的 px)
  const [sidebarWidth, setSidebarWidthState] = useState(256);
  const [conversationsWidth, setConversationsWidthState] = useState(256);
  const [artifactsWidth, setArtifactsWidthState] = useState(288);

  // 启动时读 localStorage(记忆用户偏好,与 AuthProvider 同套路)
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const v: StoredUI = JSON.parse(raw);
        if (typeof v.sidebarCollapsed === "boolean") setSidebarCollapsed(v.sidebarCollapsed);
        if (typeof v.artifactsCollapsed === "boolean") setArtifactsCollapsed(v.artifactsCollapsed);
        if (typeof v.conversationsCollapsed === "boolean") setConversationsCollapsed(v.conversationsCollapsed);
        if (typeof v.sidebarWidth === "number") setSidebarWidthState(clamp(v.sidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX));
        if (typeof v.conversationsWidth === "number") setConversationsWidthState(clamp(v.conversationsWidth, CONV_MIN, CONV_MAX));
        if (typeof v.artifactsWidth === "number") setArtifactsWidthState(clamp(v.artifactsWidth, ART_MIN, ART_MAX));
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  const persist = useCallback(
    (next: StoredUI) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // 忽略(隐私模式等)
      }
    },
    [],
  );

  // 折叠/展开:读最新 state(用 functional update 内的 prev)拼全量 persist。
  // 注意:persist 在 callback 外读其它 state 会闭包陈旧,故这里统一在 functional
  // updater 里收集所有最新值再 persist。
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      persist({
        sidebarCollapsed: next,
        artifactsCollapsed,
        conversationsCollapsed,
        sidebarWidth, conversationsWidth, artifactsWidth,
      });
      return next;
    });
  }, [artifactsCollapsed, conversationsCollapsed, sidebarWidth, conversationsWidth, artifactsWidth, persist]);

  const toggleArtifacts = useCallback(() => {
    setArtifactsCollapsed((prev) => {
      const next = !prev;
      persist({
        sidebarCollapsed, artifactsCollapsed: next, conversationsCollapsed,
        sidebarWidth, conversationsWidth, artifactsWidth,
      });
      return next;
    });
  }, [sidebarCollapsed, conversationsCollapsed, sidebarWidth, conversationsWidth, artifactsWidth, persist]);

  const toggleConversations = useCallback(() => {
    setConversationsCollapsed((prev) => {
      const next = !prev;
      persist({
        sidebarCollapsed, artifactsCollapsed, conversationsCollapsed: next,
        sidebarWidth, conversationsWidth, artifactsWidth,
      });
      return next;
    });
  }, [sidebarCollapsed, artifactsCollapsed, sidebarWidth, conversationsWidth, artifactsWidth, persist]);

  // 宽度 setter:clamp + persist。拖拽中高频调用,每帧 persist 一次 localStorage
  // 可接受(单 key 小 JSON);若实测卡再降频(松手时才 persist)。
  const setSidebarWidth = useCallback((n: number) => {
    const clamped = clamp(n, SIDEBAR_MIN, SIDEBAR_MAX);
    setSidebarWidthState(clamped);
    persist({ sidebarCollapsed, artifactsCollapsed, conversationsCollapsed, sidebarWidth: clamped, conversationsWidth, artifactsWidth });
  }, [sidebarCollapsed, artifactsCollapsed, conversationsCollapsed, conversationsWidth, artifactsWidth, persist]);

  const setConversationsWidth = useCallback((n: number) => {
    const clamped = clamp(n, CONV_MIN, CONV_MAX);
    setConversationsWidthState(clamped);
    persist({ sidebarCollapsed, artifactsCollapsed, conversationsCollapsed, sidebarWidth, conversationsWidth: clamped, artifactsWidth });
  }, [sidebarCollapsed, artifactsCollapsed, conversationsCollapsed, sidebarWidth, artifactsWidth, persist]);

  const setArtifactsWidth = useCallback((n: number) => {
    const clamped = clamp(n, ART_MIN, ART_MAX);
    setArtifactsWidthState(clamped);
    persist({ sidebarCollapsed, artifactsCollapsed, conversationsCollapsed, sidebarWidth, conversationsWidth, artifactsWidth: clamped });
  }, [sidebarCollapsed, artifactsCollapsed, conversationsCollapsed, sidebarWidth, conversationsWidth, persist]);

  return (
    <UIContext.Provider value={{
      sidebarCollapsed, artifactsCollapsed, conversationsCollapsed,
      sidebarWidth, conversationsWidth, artifactsWidth,
      toggleSidebar, toggleArtifacts, toggleConversations,
      setSidebarWidth, setConversationsWidth, setArtifactsWidth,
    }}>
      {children}
    </UIContext.Provider>
  );
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI 必须在 UIProvider 内使用");
  return ctx;
}
