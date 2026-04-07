const { Router } = require("express");
const { saveMessage, getHistory, generateReply } = require("./chat.service");
const { create, verifyOwnership, updateTimestamp } = require("../conversation/conversation.service");

const router = Router();

router.post("/", async (req, res) => {
  const { message, conversationId } = req.body;

  if (!message) {
    return res.status(400).json({ reply: "Message is required." });
  }

  try {
    let convId = conversationId;

    if (!convId) {
      const title = message.length > 50 ? message.substring(0, 50) + "…" : message;
      convId = await create(req.user.id, title);
    } else {
      const owns = await verifyOwnership(convId, req.user.id);
      if (!owns) {
        return res.status(404).json({ reply: "Conversation not found." });
      }
    }

    await saveMessage(convId, "user", message);

    const history = await getHistory(convId);
    const result = await generateReply(history);

    if (result.toolCalls) {
      // Article fetched — ready for RAG processing
      if (result.articleLength !== undefined) {
        return res.json({
          reply: result.text,
          isSearching: false,
          articleLength: result.articleLength,
          conversationId: convId,
        });
      }

      // Still in the search phase
      return res.json({
        reply: "I am searching Wikipedia for that information...",
        isSearching: true,
        conversationId: convId,
      });
    }

    await saveMessage(convId, "server", result.text);
    await updateTimestamp(convId);

    res.json({ reply: result.text, conversationId: convId });
  } catch (error) {
    console.error("Chat error:", error.message);
    res.status(500).json({ reply: "Something went wrong. Please try again." });
  }
});

module.exports = router;
