const { Router } = require("express");
const { listByUser, getMessages, remove } = require("./conversation.service");

const router = Router();

router.get("/", async (req, res) => {
  try {
    const conversations = await listByUser(req.user.id);
    res.json(conversations);
  } catch (err) {
    console.error("List conversations error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id/messages", async (req, res) => {
  try {
    const messages = await getMessages(req.params.id, req.user.id);
    if (!messages) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    res.json(messages);
  } catch (err) {
    console.error("Get messages error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const deleted = await remove(req.params.id, req.user.id);
    if (!deleted) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Delete conversation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
