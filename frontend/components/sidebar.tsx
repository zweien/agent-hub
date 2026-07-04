"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PlaneIcon, SettingsIcon, LogOutIcon, HistoryIcon, PuzzleIcon, MessageSquareIcon, WrenchIcon } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";

const ROLE_LABEL: Record<string, string> = {
  admin: "管理员", builder: "构建者(A类)", user: "使用者(B类)",
};

export function Sidebar() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const handleLogout = () => { logout(); router.push("/login"); };

  const navItem = (href: string, icon: React.ReactNode, label: string) => {
    const active = pathname === href;
    return (
      <Link href={href} className={`flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent ${active ? "bg-accent font-medium text-foreground" : "text-muted-foreground"}`}>
        {icon} {label}
      </Link>
    );
  };

  return (
    <aside className="flex w-64 flex-col border-r bg-muted/50">
      <div className="flex items-center gap-2 px-4 py-4">
        <PlaneIcon className="size-5 text-primary" />
        <span className="font-semibold">Agent Hub</span>
      </div>

      {/* 当前用户/角色 */}
      {user && (
        <div className="mx-3 mb-2 rounded-lg bg-background/60 p-3 text-sm">
          <div className="font-medium">{user.username}</div>
          <div className="text-xs text-muted-foreground">{ROLE_LABEL[user.role] || user.role}</div>
        </div>
      )}

      {/* 导航:对话(主)+ 配置/技能/回放(控制台) */}
      <nav className="flex flex-1 flex-col gap-0.5 px-3 text-sm">
        {navItem("/", <MessageSquareIcon className="size-4" />, "对话")}
        {navItem("/agents", <SettingsIcon className="size-4" />, "Agent 配置")}
        {navItem("/tools", <WrenchIcon className="size-4" />, "工具管理")}
        {navItem("/skills", <PuzzleIcon className="size-4" />, "技能管理")}
        {navItem("/sessions", <HistoryIcon className="size-4" />, "会话回放")}
      </nav>

      <div className="border-t px-3 py-2">
        <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={handleLogout}>
          <LogOutIcon className="size-4" /> 登出
        </Button>
      </div>
    </aside>
  );
}
