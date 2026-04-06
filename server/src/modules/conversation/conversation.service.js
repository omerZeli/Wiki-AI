const { pool } = require("../../config/db");

async function listByUser(userId) {
  const result = await pool.query(
    "SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC",
    [userId]
  );
  return result.rows;
}

async function getMessages(conversationId, userId) {
  const conv = await pool.query(
    "SELECT id FROM conversations WHERE id = $1 AND user_id = $2",
    [conversationId, userId]
  );
  if (conv.rows.length === 0) return null;

  const messages = await pool.query(
    "SELECT sender, text FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC",
    [conversationId]
  );
  return messages.rows;
}

async function create(userId, title) {
  const result = await pool.query(
    "INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING id",
    [userId, title]
  );
  return result.rows[0].id;
}

async function verifyOwnership(conversationId, userId) {
  const result = await pool.query(
    "SELECT id FROM conversations WHERE id = $1 AND user_id = $2",
    [conversationId, userId]
  );
  return result.rows.length > 0;
}

async function remove(conversationId, userId) {
  const result = await pool.query(
    "DELETE FROM conversations WHERE id = $1 AND user_id = $2 RETURNING id",
    [conversationId, userId]
  );
  return result.rows.length > 0;
}

async function updateTimestamp(conversationId) {
  await pool.query("UPDATE conversations SET updated_at = NOW() WHERE id = $1", [conversationId]);
}

module.exports = { listByUser, getMessages, create, verifyOwnership, remove, updateTimestamp };
