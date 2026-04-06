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
  onClose: () => void;
}

export default function Sidebar({ open, conversations, activeId, onSelect, onNew, onDelete, onClose }: Props) {
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
                onClick={() => { onSelect(c.id); onClose(); }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter") { onSelect(c.id); onClose(); } }}
              >
                <span className={styles.itemTitle}>{c.title}</span>
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
            ))
          )}
        </div>
      </aside>
    </>
  );
}
