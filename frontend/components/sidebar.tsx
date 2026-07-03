"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PlaneIcon, SettingsIcon, LogOutIcon, HistoryIcon } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";

const ROLE_LABEL: Record<string, string> = {
  admin: "管理员", builder: "构建者(A类)", user: "使用者(B类)",
};

export function Sidebar() {
  const { user, logout } = useAuth();
  const router = useRouter();

  const handleLogout = () => { logout(); router.push("/login"); };

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

      {/* 配置入口(所有角色可看,user 只读)+ 回放查看(§8) */}
      <nav className="flex flex-1 flex-col gap-0.5 px-3 text-sm">
        <Link href="/agents" className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
          <SettingsIcon className="size-4" /> Agent 配置
        </Link>
        <Link href="/sessions" className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
          <HistoryIcon className="size-4" /> 会话回放
        </Link>
      </nav>

      <div className="border-t px-3 py-2">
        <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={handleLogout}>
          <LogOutIcon className="size-4" /> 登出
        </Button>
      </div>
    </aside>
  );
}
