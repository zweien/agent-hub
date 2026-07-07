"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/app-shell";
import { ChatView } from "@/components/chat-view";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  if (loading) return <div className="flex h-screen items-center justify-center text-muted-foreground">加载中...</div>;
  if (!user) return null;

  return (
    <AppShell mainClassName="overflow-hidden">
      <ChatView />
    </AppShell>
  );
}
