const express = require("express");
const cors = require("cors");
const chatRouter = require("./routes/chat");

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL }));
app.use(express.json());

app.use("/api/chat", chatRouter);

module.exports = app;
