const { Router } = require("express");
const groq = require("../config/groq");

const router = Router();

router.post("/", async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ reply: "Message is required." });
  }

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant called Wiki AI.",
        },
        { role: "user", content: message },
      ],
    });

    const generatedText =
      completion.choices[0]?.message?.content ?? "No response generated.";

    res.json({ reply: generatedText });
  } catch (error) {
    console.error("Groq API error:", error.message);
    res.status(500).json({ reply: "Something went wrong. Please try again." });
  }
});

module.exports = router;
