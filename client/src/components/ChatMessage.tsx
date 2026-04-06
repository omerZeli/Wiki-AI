import styles from "./ChatMessage.module.css";

interface Props {
  sender: "user" | "server";
  text: string;
}

export default function ChatMessage({ sender, text }: Props) {
  return (
    <div className={`${styles.row} ${sender === "user" ? styles.userRow : styles.serverRow}`}>
      {sender === "server" && (
        <img src="/wikiAILogo-sm.png" alt="Wiki AI" className={styles.avatar} />
      )}
      <div className={`${styles.bubble} ${sender === "user" ? styles.userBubble : styles.serverBubble}`}>
        {text}
      </div>
    </div>
  );
}
