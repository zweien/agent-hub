"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  PlaneIcon, SettingsIcon, LogOutIcon, HistoryIcon, PuzzleIcon,
  MessageSquareIcon, WrenchIcon, ServerIcon, BoxesIcon, LayoutDashboardIcon,
  BookOpenIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useUI, SIDEBAR_MIN, SIDEBAR_MAX } from "@/contexts/ui-context";
import { ResizeHandle } from "@/components/resize-handle";

const ROLE_LABEL: Record<string, string> = {
  admin: "管理员", builder: "构建者(A类)", user: "使用者(B类)",
};

export function Sidebar() {
  const { user, logout } = useAuth();
  const { sidebarCollapsed: collapsed, sidebarWidth, setSidebarWidth } = useUI();
  const router = useRouter();
  const pathname = usePathname();

  const handleLogout = () => { logout(); router.push("/login"); };

  const navItem = (href: string, icon: React.ReactNode, label: string) => {
    const active = pathname === href;
    return (
      <Link
        href={href}
        title={collapsed ? label : undefined}
        className={`flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent ${
          collapsed ? "justify-center" : ""
        } ${active ? "bg-accent font-medium text-foreground" : "text-muted-foreground"}`}
      >
        {icon}
        {!collapsed && <span>{label}</span>}
      </Link>
    );
  };

  return (
    <aside
      className={`relative flex flex-col border-r bg-muted/50 ${
        collapsed ? "w-16 transition-[width] duration-200" : ""
      }`}
      style={collapsed ? undefined : { width: sidebarWidth }}
    >
      {/* 右边缘拖拽手柄(仅展开态):调主侧栏宽度。折叠态不放手柄(避免误触展开)。 */}
      {!collapsed && (
        <ResizeHandle
          side="right"
          onResize={(delta) => setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, sidebarWidth + delta)))}
        />
      )}
      {/* Logo:折叠态只留图标 */}
      <div className={`flex items-center gap-2 px-4 py-4 ${collapsed ? "justify-center px-0" : ""}`}>
        <PlaneIcon className="size-5 shrink-0 text-primary" />
        {!collapsed && <span className="font-semibold">Agent Hub</span>}
      </div>

      {/* 当前用户/角色:折叠态隐藏 */}
      {user && !collapsed && (
        <div className="mx-3 mb-2 rounded-lg bg-background/60 p-3 text-sm">
          <div className="font-medium">{user.username}</div>
          <div className="text-xs text-muted-foreground">{ROLE_LABEL[user.role] || user.role}</div>
        </div>
      )}

      {/* 导航 */}
      <nav className="flex flex-1 flex-col gap-0.5 px-3 text-sm">
        {navItem("/", <LayoutDashboardIcon className="size-4 shrink-0" />, "仪表盘")}
        {navItem("/chat", <MessageSquareIcon className="size-4 shrink-0" />, "对话")}
        {navItem("/agents", <SettingsIcon className="size-4 shrink-0" />, "Agent 配置")}
        {navItem("/tools", <WrenchIcon className="size-4 shrink-0" />, "工具管理")}
        {navItem("/models", <BoxesIcon className="size-4 shrink-0" />, "模型管理")}
        {navItem("/skills", <PuzzleIcon className="size-4 shrink-0" />, "技能管理")}
        {navItem("/knowledge", <BookOpenIcon className="size-4 shrink-0" />, "知识库")}
        {navItem("/sandbox-templates", <BoxesIcon className="size-4 shrink-0" />, "沙箱模板")}
        {navItem("/sessions", <HistoryIcon className="size-4 shrink-0" />, "会话回放")}
        {user?.role === "admin" && navItem("/sandboxes", <ServerIcon className="size-4 shrink-0" />, "沙箱管理")}
      </nav>

      {/* 登出:折叠态只留图标 */}
      <div className="border-t px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          title={collapsed ? "登出" : undefined}
          className={`w-full text-muted-foreground ${collapsed ? "justify-center px-0" : "justify-start"}`}
          onClick={handleLogout}
        >
          <LogOutIcon className="size-4 shrink-0" />
          {!collapsed && "登出"}
        </Button>
      </div>
    </aside>
  );
}
