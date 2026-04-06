import { useState, type FormEvent } from "react";

interface Message {
  sender: "user" | "server";
  text: string;
}

const API_URL = "http://localhost:3001/api/chat";

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;

    setMessages((prev) => [...prev, { sender: "user", text }]);
    setInput("");
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
        { sender: "server", text: "Error: could not reach server." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 600, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h1>Chat</h1>
      <div
        style={{
          border: "1px solid #ccc",
          borderRadius: 8,
          height: 400,
          overflowY: "auto",
          padding: "1rem",
          marginBottom: "1rem",
          background: "#fafafa",
        }}
      >
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              textAlign: msg.sender === "user" ? "right" : "left",
              margin: "0.5rem 0",
            }}
          >
            <span
              style={{
                display: "inline-block",
                padding: "0.5rem 0.75rem",
                borderRadius: 16,
                background: msg.sender === "user" ? "#0070f3" : "#e2e2e2",
                color: msg.sender === "user" ? "#fff" : "#000",
              }}
            >
              {msg.text}
            </span>
          </div>
        ))}
        {loading && <p style={{ color: "#888" }}>Waiting for server…</p>}
      </div>
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.5rem" }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          aria-label="Chat message"
          style={{ flex: 1, padding: "0.5rem", fontSize: "1rem", borderRadius: 4, border: "1px solid #ccc" }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{ padding: "0.5rem 1rem", fontSize: "1rem", borderRadius: 4, cursor: "pointer" }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
