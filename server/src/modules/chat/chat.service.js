const { pool } = require("../../config/db");
const groq = require("../../config/groq");

async function saveMessage(conversationId, sender, text) {
  await pool.query(
    "INSERT INTO messages (conversation_id, sender, text) VALUES ($1, $2, $3)",
    [conversationId, sender, text]
  );
}

async function getHistory(conversationId) {
  // Fetch the last 10 messages (newest first), then reverse to chronological order
  const result = await pool.query(
    `SELECT sender, text FROM (
       SELECT sender, text, created_at
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT 10
     ) AS recent
     ORDER BY created_at ASC`,
    [conversationId]
  );
  return result.rows;
}

async function generateReply(history) {
  const groqMessages = [
    { role: "system", content: "You are a helpful assistant called Wiki AI." },
    ...history.map((m) => ({
      role: m.sender === "user" ? "user" : "assistant",
      content: m.text,
    })),
  ];

  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: groqMessages,
  });

  return completion.choices[0]?.message?.content ?? "No response generated.";
}

module.exports = { saveMessage, getHistory, generateReply };
