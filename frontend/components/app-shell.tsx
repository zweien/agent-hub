"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { Button } from "@/components/ui/button";
import { PanelLeftIcon } from "lucide-react";
import { useUI } from "@/contexts/ui-context";
import { useAuth } from "@/contexts/auth-context";

// 路径 → 顶栏标题
const TITLE_MAP: Record<string, string> = {
  "/": "仪表盘",
  "/chat": "对话",
  "/agents": "Agent 配置",
  "/tools": "工具管理",
  "/skills": "技能管理",
  "/sandbox-templates": "沙箱模板",
  "/sessions": "会话回放",
  "/sandboxes": "沙箱管理",
};

export function AppShell({
  children,
  mainClassName = "overflow-auto",
}: {
  children: React.ReactNode;
  /** main 的额外类名;首页需 overflow-hidden(ChatView 自管滚动),其余默认 overflow-auto */
  mainClassName?: string;
}) {
  const { sidebarCollapsed, toggleSidebar } = useUI();
  const pathname = usePathname();
  const { user } = useAuth();
  const title = TITLE_MAP[pathname] ?? "";

  // 顶栏只在登录后显示(无 user 的场景不应进 AppShell,但稳妥起见)
  if (!user) return <>{children}</>;

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 顶栏:折叠按钮 + 页面标题 */}
        <header className="flex h-10 shrink-0 items-center gap-1 border-b bg-background px-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            <PanelLeftIcon className="size-4" />
          </Button>
          {title && <span className="text-sm font-medium text-foreground">{title}</span>}
        </header>
        <main className={`flex-1 ${mainClassName}`}>{children}</main>
      </div>
    </div>
  );
}
