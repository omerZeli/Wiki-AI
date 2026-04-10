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
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { user, token, logout } = useAuth();

  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (editingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [editingTitle]);

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

  const renameConversation = async (id: number, newTitle: string) => {
    try {
      const res = await fetch(`${BASE}/api/conversations/${id}`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ title: newTitle }),
      });
      if (res.ok) {
        setConversations((prev) =>
          prev.map((c) => (c.id === id ? { ...c, title: newTitle } : c))
        );
      }
    } catch {
      /* silent */
    }
  };

  const startTitleEdit = () => {
    if (!activeConvId) return;
    const conv = conversations.find((c) => c.id === activeConvId);
    setTitleDraft(conv?.title ?? "");
    setEditingTitle(true);
  };

  const commitTitleEdit = () => {
    if (activeConvId && titleDraft.trim()) {
      renameConversation(activeConvId, titleDraft.trim());
    }
    setEditingTitle(false);
  };

  const cancelTitleEdit = () => setEditingTitle(false);

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
        onRename={renameConversation}
        onClose={() => setSidebarOpen(false)}
      />

      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.menuBtn} onClick={() => setSidebarOpen(true)} aria-label="Open chat history">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <button className={styles.menuBtn} onClick={startNewChat} aria-label="New chat">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.375 2.625a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.375-9.375z" />
            </svg>
          </button>
        </div>
        <div className={styles.headerCenter}>
          <img src="/wikiAILogo-sm.png" alt="" className={styles.logoImg} />
          <span className={styles.logo}>Wiki AI</span>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.userName}>{user?.name}</span>
          <button className={styles.logoutBtn} onClick={logout}>Log out</button>
        </div>
      </header>

      <div className={styles.wikiTitle}>
        {editingTitle ? (
          <>
            <input
              ref={titleInputRef}
              className={styles.wikiTitleInput}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitTitleEdit();
                if (e.key === "Escape") cancelTitleEdit();
              }}
            />
            <div className={styles.wikiTitleActions}>
              <button className={styles.wikiTitleBtn} onClick={commitTitleEdit} aria-label="Confirm rename">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
              <button className={styles.wikiTitleBtnCancel} onClick={cancelTitleEdit} aria-label="Cancel rename">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </>
        ) : (
          <>
            <h1>{activeConvId ? conversations.find((c) => c.id === activeConvId)?.title : "New Chat"}</h1>
            {activeConvId && (
              <button className={styles.wikiTitleEditBtn} onClick={startTitleEdit} aria-label="Edit title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 1 1 3.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            )}
          </>
        )}
      </div>

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
