<p align="center">
  <img src="client/public/wikiAILogo.png" alt="Wiki AI Logo" width="120" />
</p>

<h1 align="center">Wiki AI</h1>

<p align="center">
  An AI-powered chat application that answers your questions using real-time Wikipedia knowledge.<br/>
  Built with a RAG (Retrieval-Augmented Generation) pipeline, so every answer is grounded in actual sources.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white" alt="Express 5" />
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL 16" />
  <img src="https://img.shields.io/badge/Groq-LLaMA_3-F55036?logo=meta&logoColor=white" alt="Groq LLaMA 3" />
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white" alt="Docker Ready" />
</p>

---

## How It Works

When you ask a question, Wiki AI doesn't just guess — it follows a structured research pipeline:

1. **Search** — An LLM agent searches Wikipedia for relevant article titles
2. **Retrieve** — The full article text is fetched from the Wikipedia API
3. **Chunk & Embed** — The article is split into chunks and embedded using `all-MiniLM-L6-v2`
4. **Rank** — Cosine similarity finds the most relevant chunks for your query
5. **Answer** — The top chunks are sent to `LLaMA 3.3 70B` (via Groq) to generate a grounded answer with source links

## Features

- 🔍 **RAG-powered answers** — Every response is backed by real Wikipedia content
- 🔗 **Source attribution** — Answers include links to the original Wikipedia articles
- 💬 **Conversation history** — Persistent chat threads stored in PostgreSQL
- 🧠 **Coreference resolution** — Follow-up questions like "when was he born?" just work
- ✏️ **Rename & manage chats** — Rename, delete, and switch between conversations
- 🔐 **JWT authentication** — Secure user registration and login
- 🐳 **Dockerized** — One command to run the entire stack

## Tech Stack

| Layer       | Technology                                                                 |
| ----------- | -------------------------------------------------------------------------- |
| Frontend    | React 19, TypeScript, Vite, React Router, React Markdown                  |
| Backend     | Node.js, Express 5                                                        |
| Database    | PostgreSQL 16                                                              |
| AI / LLM    | Groq SDK (LLaMA 3.3 70B for RAG, LLaMA 3.1 8B for routing & rewriting)  |
| Embeddings  | Transformers.js (`Xenova/all-MiniLM-L6-v2`), LangChain text splitters    |
| Similarity  | `ml-distance` (cosine similarity)                                         |
| Auth        | bcrypt, JSON Web Tokens                                                    |
| DevOps      | Docker, Docker Compose, Nginx                                              |

## Getting Started

### Prerequisites

- [Docker](https://www.docker.com/)
- A [Groq API key](https://console.groq.com/)

### 1. Clone the repository

```bash
git clone https://github.com/your-username/wiki-ai.git
cd wiki-ai
```

### 2. Set up environment variables

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

Edit `server/.env` and add your `GROQ_API_KEY` and `JWT_SECRET`.

### 3. Choose how to run

There are two ways to get up and running:

| | Option A — Docker | Option B — Local Dev |
|---|---|---|
| Best for | Running / demoing the app | Active development with hot-reload |
| What's containerized | Everything (DB + Server + Client) | Database only |
| Extra requirements | None | Node.js v20+ |

---

### Option A — Run everything with Docker

Spin up the entire stack with a single command:

```bash
docker compose up --build
```

This starts PostgreSQL, the API server, and the client (Nginx).

Open [http://localhost:8080](http://localhost:8080) and you're good to go.

---

### Option B — Local development

Run only the database in Docker, and start the server & client locally for hot-reload and a faster feedback loop.

#### 1. Start the database

```bash
docker compose -f docker-compose.dev.yml up -d
```

#### 2. Install dependencies

```bash
# Server
cd server
npm install

# Client
cd ../client
npm install
```

#### 3. Run the app

```bash
# Terminal 1 — Server
cd server
npm start

# Terminal 2 — Client
cd client
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Project Structure

```
wiki-ai/
├── client/                  # React frontend
│   ├── src/
│   │   ├── components/      # ChatInput, ChatMessage, Sidebar
│   │   ├── context/         # AuthContext (JWT state management)
│   │   └── pages/           # ChatPage, LoginPage, RegisterPage
│   ├── Dockerfile
│   └── nginx.conf
├── server/                  # Express backend
│   ├── src/
│   │   ├── config/          # Database pool, Groq client
│   │   ├── middleware/      # JWT auth middleware
│   │   └── modules/
│   │       ├── auth/        # Register & login routes
│   │       ├── chat/        # RAG pipeline & Wikipedia tools
│   │       └── conversation/# CRUD for chat threads
│   ├── server.js
│   └── Dockerfile
├── docker-compose.yml       # Production stack
└── docker-compose.dev.yml   # Dev database only
```

## API Endpoints

| Method   | Endpoint                          | Auth | Description                  |
| -------- | --------------------------------- | ---- | ---------------------------- |
| `POST`   | `/api/auth/register`              | No   | Create a new account         |
| `POST`   | `/api/auth/login`                 | No   | Sign in and receive a JWT    |
| `POST`   | `/api/chat`                       | Yes  | Send a message, get AI reply |
| `GET`    | `/api/conversations`              | Yes  | List user's conversations    |
| `GET`    | `/api/conversations/:id/messages` | Yes  | Get messages in a thread     |
| `PATCH`  | `/api/conversations/:id`          | Yes  | Rename a conversation        |
| `DELETE` | `/api/conversations/:id`          | Yes  | Delete a conversation        |
