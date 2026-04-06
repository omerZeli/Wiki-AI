const express = require("express");
const cors = require("cors");
const authRouter = require("./modules/auth/auth.routes");
const chatRouter = require("./modules/chat/chat.routes");
const conversationsRouter = require("./modules/conversation/conversation.routes");
const authMiddleware = require("./middleware/auth");

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL }));
app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api/chat", authMiddleware, chatRouter);
app.use("/api/conversations", authMiddleware, conversationsRouter);

module.exports = app;
