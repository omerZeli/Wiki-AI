const express = require("express");
const cors = require("cors");
const chatRouter = require("./routes/chat");
const authRouter = require("./routes/auth");
const authMiddleware = require("./middleware/auth");

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL }));
app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api/chat", authMiddleware, chatRouter);

module.exports = app;
