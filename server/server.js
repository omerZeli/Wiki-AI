const express = require("express");
const cors = require("cors");

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

app.post("/api/chat", (req, res) => {
  const { message } = req.body;
  res.json({ reply: `Server received your message: ${message}` });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
