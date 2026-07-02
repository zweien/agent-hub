import { Sidebar } from "@/components/sidebar";
import { ChatView } from "@/components/chat-view";

export default function Home() {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <ChatView />
      </main>
    </div>
  );
}
