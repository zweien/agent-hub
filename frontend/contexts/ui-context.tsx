"use client";

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";

interface UIContextValue {
  sidebarCollapsed: boolean;
  artifactsCollapsed: boolean;
  conversationsCollapsed: boolean;
  toggleSidebar: () => void;
  toggleArtifacts: () => void;
  toggleConversations: () => void;
}

const UIContext = createContext<UIContextValue | null>(null);

const STORAGE_KEY = "agenthub_ui";

interface StoredUI {
  sidebarCollapsed?: boolean;
  artifactsCollapsed?: boolean;
  conversationsCollapsed?: boolean;
}

export function UIProvider({ children }: { children: ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [artifactsCollapsed, setArtifactsCollapsed] = useState(false);
  // 对话列表默认折叠(w-12 rail);对话页四栏布局(主侧栏+本面板+消息+产物),
  // 默认展开会挤占消息区,故默认收起,用户按需展开。
  const [conversationsCollapsed, setConversationsCollapsed] = useState(true);

  // 启动时读 localStorage(记忆用户偏好,与 AuthProvider 同套路)
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const v: StoredUI = JSON.parse(raw);
        if (typeof v.sidebarCollapsed === "boolean") setSidebarCollapsed(v.sidebarCollapsed);
        if (typeof v.artifactsCollapsed === "boolean") setArtifactsCollapsed(v.artifactsCollapsed);
        if (typeof v.conversationsCollapsed === "boolean") setConversationsCollapsed(v.conversationsCollapsed);
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

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      persist({ sidebarCollapsed: next, artifactsCollapsed, conversationsCollapsed });
      return next;
    });
  }, [artifactsCollapsed, conversationsCollapsed, persist]);

  const toggleArtifacts = useCallback(() => {
    setArtifactsCollapsed((prev) => {
      const next = !prev;
      persist({ sidebarCollapsed, artifactsCollapsed: next, conversationsCollapsed });
      return next;
    });
  }, [sidebarCollapsed, conversationsCollapsed, persist]);

  const toggleConversations = useCallback(() => {
    setConversationsCollapsed((prev) => {
      const next = !prev;
      persist({ sidebarCollapsed, artifactsCollapsed, conversationsCollapsed: next });
      return next;
    });
  }, [sidebarCollapsed, artifactsCollapsed, persist]);

  return (
    <UIContext.Provider value={{ sidebarCollapsed, artifactsCollapsed, conversationsCollapsed, toggleSidebar, toggleArtifacts, toggleConversations }}>
      {children}
    </UIContext.Provider>
  );
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI 必须在 UIProvider 内使用");
  return ctx;
}
