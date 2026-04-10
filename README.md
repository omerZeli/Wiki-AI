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

- [Node.js](https://nodejs.org/) (v20+)
- [Docker](https://www.docker.com/) & Docker Compose
- A [Groq API](https://console.groq.com/) key

### 1. Clone the repo

```bash
git clone https://github.com/omerZeli/wiki-ai.git
cd wiki-ai
```

### 2. Configure environment variables

```bash
# Server
cp server/.env.example server/.env
# Edit server/.env and fill in:
#   GROQ_API_KEY=your_groq_key
#   JWT_SECRET=a-strong-random-secret

# Client
cp client/.env.example client/.env
# Default API URL is http://localhost:3000 — adjust if needed
```

### 3. Run with Docker (recommended)

```bash
# Full stack (DB + Server + Client)
docker compose up --build

# App available at http://localhost:8080
# API available at http://localhost:3000
```

### 4. Run locally for development

```bash
# Start only the database
docker compose -f docker-compose.dev.yml up -d

# Server
cd server
npm install
npm start

# Client (in a separate terminal)
cd client
npm install
npm run dev
```

The client dev server runs at `http://localhost:5173` and the API at `http://localhost:3000`.

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
