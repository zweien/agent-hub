"use client";

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";

interface UIContextValue {
  sidebarCollapsed: boolean;
  artifactsCollapsed: boolean;
  toggleSidebar: () => void;
  toggleArtifacts: () => void;
}

const UIContext = createContext<UIContextValue | null>(null);

const STORAGE_KEY = "agenthub_ui";

interface StoredUI {
  sidebarCollapsed?: boolean;
  artifactsCollapsed?: boolean;
}

export function UIProvider({ children }: { children: ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [artifactsCollapsed, setArtifactsCollapsed] = useState(false);

  // 启动时读 localStorage(记忆用户偏好,与 AuthProvider 同套路)
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const v: StoredUI = JSON.parse(raw);
        if (typeof v.sidebarCollapsed === "boolean") setSidebarCollapsed(v.sidebarCollapsed);
        if (typeof v.artifactsCollapsed === "boolean") setArtifactsCollapsed(v.artifactsCollapsed);
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
      persist({ sidebarCollapsed: next, artifactsCollapsed });
      return next;
    });
  }, [artifactsCollapsed, persist]);

  const toggleArtifacts = useCallback(() => {
    setArtifactsCollapsed((prev) => {
      const next = !prev;
      persist({ sidebarCollapsed, artifactsCollapsed: next });
      return next;
    });
  }, [sidebarCollapsed, persist]);

  return (
    <UIContext.Provider value={{ sidebarCollapsed, artifactsCollapsed, toggleSidebar, toggleArtifacts }}>
      {children}
    </UIContext.Provider>
  );
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI 必须在 UIProvider 内使用");
  return ctx;
}
