"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, API_BASE } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { PlaneIcon } from "lucide-react";

const QUICK_ACCOUNTS = [
  { username: "admin", password: "admin123", label: "管理员", desc: "全部权限" },
  { username: "builder", password: "builder123", label: "构建者(A类)", desc: "配置/发布 agent" },
  { username: "user", password: "user123", label: "使用者(B类)", desc: "对话 + 只读看配置" },
];

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const doLogin = async (u: string, p: string) => {
    setError("");
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p }),
      });
      if (!res.ok) {
        const e = await res.json();
        setError(e.detail || "登录失败");
        return;
      }
      const data = await res.json();
      login(data.token, data.username, data.role);
      router.push("/");
    } catch (e) {
      setError("网络错误");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30">
      <div className="w-full max-w-sm rounded-2xl border bg-background p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <PlaneIcon className="size-6 text-primary" />
          <h1 className="text-xl font-semibold">Agent Hub</h1>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); doLogin(username, password); }} className="space-y-3">
          <input
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            placeholder="用户名" value={username} onChange={(e) => setUsername(e.target.value)}
          />
          <input
            type="password" className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            placeholder="密码" value={password} onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full">登录</Button>
        </form>
        <div className="mt-6 border-t pt-4">
          <p className="mb-2 text-xs text-muted-foreground">快捷登录(测试用):</p>
          <div className="space-y-1.5">
            {QUICK_ACCOUNTS.map((a) => (
              <button key={a.username} onClick={() => doLogin(a.username, a.password)}
                className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-sm hover:bg-accent">
                <span className="font-medium">{a.label}</span>
                <span className="text-xs text-muted-foreground">{a.desc}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
