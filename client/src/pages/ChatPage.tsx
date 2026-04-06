import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import ChatMessage from "../components/ChatMessage";
import ChatInput from "../components/ChatInput";
import Sidebar, { type Conversation } from "../components/Sidebar";
import styles from "./ChatPage.module.css";

interface Message {
  sender: "user" | "server";
  text: string;
}

const BASE = import.meta.env.VITE_API_URL;

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { user, token, logout } = useAuth();

  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/conversations`, { headers: authHeaders });
      if (res.ok) {
        setConversations(await res.json());
      }
    } catch {
      /* silent */
    }
  }, [token]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const loadConversation = async (id: number) => {
    try {
      const res = await fetch(`${BASE}/api/conversations/${id}/messages`, { headers: authHeaders });
      if (res.status === 401) { logout(); return; }
      if (res.ok) {
        const msgs: Message[] = await res.json();
        setMessages(msgs);
        setActiveConvId(id);
      }
    } catch {
      /* silent */
    }
  };

  const startNewChat = () => {
    setMessages([]);
    setActiveConvId(null);
  };

  const deleteConversation = async (id: number) => {
    try {
      await fetch(`${BASE}/api/conversations/${id}`, { method: "DELETE", headers: authHeaders });
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConvId === id) startNewChat();
    } catch {
      /* silent */
    }
  };

  const handleSend = async (text: string) => {
    setMessages((prev) => [...prev, { sender: "user", text }]);
    setLoading(true);

    try {
      const res = await fetch(`${BASE}/api/chat`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ message: text, conversationId: activeConvId }),
      });

      if (res.status === 401) { logout(); return; }

      const data = await res.json();
      setMessages((prev) => [...prev, { sender: "server", text: data.reply }]);

      // Track the conversation id
      if (data.conversationId && !activeConvId) {
        setActiveConvId(data.conversationId);
      }

      // Refresh sidebar list
      fetchConversations();
    } catch {
      setMessages((prev) => [...prev, { sender: "server", text: "Could not reach the server." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.layout}>
      <Sidebar
        open={sidebarOpen}
        conversations={conversations}
        activeId={activeConvId}
        onSelect={loadConversation}
        onNew={startNewChat}
        onDelete={deleteConversation}
        onClose={() => setSidebarOpen(false)}
      />

      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.menuBtn} onClick={() => setSidebarOpen(true)} aria-label="Open chat history">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <span className={styles.logo}>Wiki AI</span>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.userName}>{user?.name}</span>
          <button className={styles.logoutBtn} onClick={logout}>Log out</button>
        </div>
      </header>

      <main className={styles.messages}>
        {messages.length === 0 && (
          <div className={styles.empty}><h2>What can I help with?</h2></div>
        )}
        {messages.map((msg, i) => (
          <ChatMessage key={i} sender={msg.sender} text={msg.text} />
        ))}
        {loading && (
          <div className={styles.thinking}>
            <span className={styles.dot} /><span className={styles.dot} /><span className={styles.dot} />
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      <footer className={styles.footer}>
        <ChatInput onSend={handleSend} disabled={loading} />
      </footer>
    </div>
  );
}
