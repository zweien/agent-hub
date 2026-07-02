"use client";

import { Button } from "@/components/ui/button";
import { PlaneIcon } from "lucide-react";

export function Sidebar() {
  return (
    <aside className="flex w-64 flex-col border-r bg-muted/50">
      <div className="flex items-center gap-2 px-4 py-4">
        <PlaneIcon className="size-5 text-primary" />
        <span className="font-semibold">Agent Hub</span>
      </div>
      <div className="px-3">
        <Button variant="outline" className="w-full justify-start" disabled>
          + 新建对话
        </Button>
      </div>
      <nav className="mt-4 flex-1 px-3 text-sm text-muted-foreground">
        <p className="px-2 py-1 text-xs uppercase tracking-wide">会话列表</p>
        <div className="rounded-md px-2 py-1.5 hover:bg-accent cursor-pointer text-foreground">
          当前会话(气动优化)
        </div>
        <p className="px-2 py-3 text-xs italic">V1:会话列表占位,多会话管理留 V2</p>
      </nav>
      <div className="border-t px-4 py-3 text-xs text-muted-foreground">
        机翼气动优化助手 · v0.1
      </div>
    </aside>
  );
}
