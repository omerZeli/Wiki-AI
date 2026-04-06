import { useState, useRef, useEffect } from "react";
import ChatMessage from "../components/ChatMessage";
import ChatInput from "../components/ChatInput";
import styles from "./ChatPage.module.css";

interface Message {
  sender: "user" | "server";
  text: string;
}

const API_URL = `${import.meta.env.VITE_API_URL}/api/chat`;

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleSend = async (text: string) => {
    setMessages((prev) => [...prev, { sender: "user", text }]);
    setLoading(true);

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { sender: "server", text: data.reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { sender: "server", text: "Could not reach the server." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <span className={styles.logo}>Wiki AI</span>
      </header>

      <main className={styles.messages}>
        {messages.length === 0 && (
          <div className={styles.empty}>
            <h2>What can I help with?</h2>
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessage key={i} sender={msg.sender} text={msg.text} />
        ))}
        {loading && (
          <div className={styles.thinking}>
            <span className={styles.dot} />
            <span className={styles.dot} />
            <span className={styles.dot} />
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
