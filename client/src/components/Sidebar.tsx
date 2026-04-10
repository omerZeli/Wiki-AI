import { useState, useRef, useEffect } from "react";
import styles from "./Sidebar.module.css";

export interface Conversation {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

interface Props {
  open: boolean;
  conversations: Conversation[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
  onDelete: (id: number) => void;
  onRename: (id: number, newTitle: string) => void;
  onClose: () => void;
}

export default function Sidebar({ open, conversations, activeId, onSelect, onNew, onDelete, onRename, onClose }: Props) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId !== null) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingId]);

  const startEditing = (c: Conversation) => {
    setEditingId(c.id);
    setEditValue(c.title);
  };

  const commitEdit = () => {
    if (editingId !== null && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

  return (
    <>
      {open && <div className={styles.overlay} onClick={onClose} />}
      <aside className={`${styles.sidebar} ${open ? styles.open : ""}`} aria-label="Chat history">
        <div className={styles.sidebarHeader}>
          <span className={styles.sidebarTitle}>Chats</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close sidebar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <button className={styles.newChatBtn} onClick={() => { onNew(); onClose(); }}>
          + New Chat
        </button>

        <div className={styles.list}>
          {conversations.length === 0 ? (
            <p className={styles.empty}>No previous chats</p>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                className={`${styles.item} ${c.id === activeId ? styles.itemActive : ""}`}
                onClick={() => { if (editingId !== c.id) { onSelect(c.id); onClose(); } }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" && editingId !== c.id) { onSelect(c.id); onClose(); } }}
              >
                {editingId === c.id ? (
                  <input
                    ref={inputRef}
                    className={styles.editInput}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit();
                      if (e.key === "Escape") cancelEdit();
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className={styles.itemTitle}>{c.title}</span>
                )}
                {editingId === c.id ? (
                  <div className={styles.itemActions} style={{ opacity: 1 }}>
                    <button
                      className={styles.confirmBtn}
                      onClick={(e) => { e.stopPropagation(); commitEdit(); }}
                      aria-label="Confirm rename"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                    <button
                      className={styles.cancelBtn}
                      onClick={(e) => { e.stopPropagation(); cancelEdit(); }}
                      aria-label="Cancel rename"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <div className={styles.itemActions}>
                    <button
                      className={styles.editBtn}
                      onClick={(e) => { e.stopPropagation(); startEditing(c); }}
                      aria-label={`Rename chat: ${c.title}`}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 1 1 3.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    <button
                      className={styles.deleteBtn}
                      onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
                      aria-label={`Delete chat: ${c.title}`}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6" /><path d="M14 11v6" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  );
}
