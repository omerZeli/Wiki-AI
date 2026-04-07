const { pool } = require("../../config/db");
const groq = require("../../config/groq");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { pipeline } = require("@xenova/transformers");
const { similarity } = require("ml-distance");
const cosineSimilarity = similarity.cosine;

const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const MAX_RETRIES = 1;

// ── Embedding pipeline (lazy-loaded singleton) ──────────────────────────

let embedder = null;

async function getEmbedder() {
  if (!embedder) {
    console.log("Loading embedding model (first call only)...");
    embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    console.log("Embedding model loaded.");
  }
  return embedder;
}

async function embed(text) {
  const model = await getEmbedder();
  const output = await model(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

// ── In-Memory RAG helpers ───────────────────────────────────────────────

async function chunkText(text) {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });
  return splitter.splitText(text);
}

async function findRelevantChunks(query, chunks, topK = 3) {
  const queryEmbedding = await embed(query);

  const chunkEmbeddings = await Promise.all(
    chunks.map(async (chunk) => ({
      text: chunk,
      embedding: await embed(chunk),
    }))
  );

  const scored = chunkEmbeddings.map((c) => ({
    text: c.text,
    score: cosineSimilarity(queryEmbedding, c.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((s) => s.text);
}

async function ragAnswer(userQuery, articleText, articleTitle) {
  console.log(`Starting RAG pipeline for query: "${userQuery}"`);

  const chunks = await chunkText(articleText);
  console.log(`Split article into ${chunks.length} chunks.`);

  const topChunks = await findRelevantChunks(userQuery, chunks, 10);
  console.log(`Found top ${topChunks.length} relevant chunks.`);

  const excerpts = topChunks
    .map((c, i) => `[Excerpt ${i + 1} from article "${articleTitle}"]:\n${c}`)
    .join("\n\n");

  const ragCompletion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: `You are a helpful research assistant. Answer the user's question based STRICTLY on the following Wikipedia excerpts from the article titled "${articleTitle}". If the answer is not contained in the excerpts, respond with exactly "INFORMATION_NOT_FOUND" and nothing else. Do not use any outside knowledge. Answer directly and naturally. NEVER start your answer with "According to the excerpt" or "Based on the text". Just provide the facts.\n\nExcerpts:\n${excerpts}`,
      },
      {
        role: "user",
        content: userQuery,
      },
    ],
  });

  const answer =
    ragCompletion.choices[0]?.message?.content ?? "No response generated.";
  console.log("RAG answer generated successfully.");
  return answer;
}

// ── Tool definitions ────────────────────────────────────────────────────

const tools = [
  {
    type: "function",
    function: {
      name: "search_wikipedia_query",
      description:
        "Use this tool FIRST to search Wikipedia for the correct article title based on keywords. Returns a list of potential article titles and snippets.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search keywords to look up on Wikipedia.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_wikipedia_article",
      description:
        "Use this tool SECOND to fetch the full text of a Wikipedia article using the exact title found via search_wikipedia_query.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "The exact Wikipedia article title to fetch.",
          },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
  },
];

// ── Wikipedia helper functions ──────────────────────────────────────────

async function searchWikipedia(query) {
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: "3",
    format: "json",
    origin: "*",
  });

  const res = await fetch(`${WIKIPEDIA_API}?${params}`);
  if (!res.ok) throw new Error(`Wikipedia search failed: ${res.statusText}`);

  const data = await res.json();
  return (data.query?.search ?? []).map(({ title, snippet }) => ({
    title,
    snippet: snippet.replace(/<[^>]+>/g, ""),
  }));
}

async function getWikipediaArticle(title) {
  const params = new URLSearchParams({
    action: "query",
    prop: "extracts",
    explaintext: "true",
    titles: title,
    format: "json",
    origin: "*",
  });

  const res = await fetch(`${WIKIPEDIA_API}?${params}`);
  if (!res.ok) throw new Error(`Wikipedia article fetch failed: ${res.statusText}`);

  const data = await res.json();
  const pages = data.query?.pages ?? {};
  const page = Object.values(pages)[0];
  return page?.extract ?? "";
}

// ── Database helpers ────────────────────────────────────────────────────

async function saveMessage(conversationId, sender, text) {
  await pool.query(
    "INSERT INTO messages (conversation_id, sender, text) VALUES ($1, $2, $3)",
    [conversationId, sender, text]
  );
}

async function getHistory(conversationId) {
  const result = await pool.query(
    `SELECT sender, text FROM (
       SELECT sender, text, created_at
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT 10
     ) AS recent
     ORDER BY created_at ASC`,
    [conversationId]
  );
  return result.rows;
}

// ── Groq call wrapper with retry on tool_use_failed ─────────────────────

async function callGroq(messages, toolChoice = "auto") {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages,
        tools,
        tool_choice: toolChoice,
      });
    } catch (err) {
      const isToolUseFailed =
        err.status === 400 && err.error?.error?.code === "tool_use_failed";

      if (isToolUseFailed && attempt < MAX_RETRIES) {
        console.warn(
          `Groq tool_use_failed on attempt ${attempt + 1}. Retrying with tool_choice: "required"...`
        );
        toolChoice = "required";
        continue;
      }
      throw err;
    }
  }
}

// ── Execute a single tool call and return the result as a string ─────────

async function executeTool(toolCall, userQuery) {
  const { name } = toolCall.function;
  const args = JSON.parse(toolCall.function.arguments);

  console.log(`Tool call: ${name}(${JSON.stringify(args)})`);

  if (name === "search_wikipedia_query") {
    const results = await searchWikipedia(args.query);
    console.log(`Wikipedia search returned ${results.length} results.`);
    return JSON.stringify(results);
  }

  if (name === "get_wikipedia_article") {
    const articleText = await getWikipediaArticle(args.title);
    console.log(`Fetched article "${args.title}" (${articleText.length} chars). Starting RAG...`);
    const answer = await ragAnswer(userQuery, articleText, args.title);
    return answer;
  }

  return "Unknown tool.";
}

// ── Coreference resolution: rewrite query to be standalone ──────────────

async function rewriteQuery(history) {
  const mapped = history.map((m) => ({
    role: m.sender === "user" ? "user" : "assistant",
    content: m.text,
  }));

  const result = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content:
          "You are a contextual query rewriter. Look at the conversation history and rewrite the user's latest message into a self-contained, standalone question, resolving any pronouns (he, she, it, this, etc.) to their specific entities. Output ONLY the rewritten question string. Do not answer the question.",
      },
      ...mapped,
    ],
  });

  return result.choices[0]?.message?.content?.trim() ?? "";
}

// ── Main reply generator with agentic ReAct loop ────────────────────────

async function generateReply(history) {
  const MAX_ITERATIONS = 4;

  // Extract the user's original question (last user message)
  const userQuery =
    [...history].reverse().find((m) => m.sender === "user")?.text ?? "";

  // Resolve pronouns / coreferences into a standalone query
  const standaloneQuery = await rewriteQuery(history);
  console.log(`Original: "${userQuery}" | Standalone: "${standaloneQuery}"`);

  const systemMessage = {
    role: "system",
    content: `You are a helpful Wikipedia Research Assistant. Today's date is ${new Date().toISOString()}.

- Factual questions: You must use the "search_wikipedia_query" tool first.
- Reading articles: After searching, you will receive a list of results. To read the full article, you must use the "get_wikipedia_article" tool. You must provide the EXACT 'title' from one of the search results. Do not guess or invent article titles.
- Research loop: If a tool returns "INFORMATION_NOT_FOUND", you must NOT give up. Think of a different search query, or fetch a different article from your previous search results, and try again.
- General conversation: Reply naturally in plain text without calling functions.
- Past history: Facts in the history are already verified. No need to research them again unless the user asks a new question.`,
  };

  const groqMessages = [
    systemMessage,
    ...history.map((m) => ({
      role: m.sender === "user" ? "user" : "assistant",
      content: m.text,
    })),
  ];

  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    const completion = await callGroq(groqMessages);
    const choice = completion.choices[0];

    if (!choice?.message) break;

    const assistantMessage = choice.message;
    groqMessages.push(assistantMessage);

    // If the model replies with text and no tools, the agent is done
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      return {
        text: assistantMessage.content ?? "No response generated.",
        toolCalls: null,
      };
    }

    // Otherwise, execute tools and feed results back into the loop
    for (const toolCall of assistantMessage.tool_calls) {
      const resultText = await executeTool(toolCall, standaloneQuery);
      groqMessages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: resultText,
      });
    }

    iterations++;
  }

  return {
    text: "After extensive research across multiple Wikipedia articles, I couldn't find the exact information.",
    toolCalls: null,
  };
}

module.exports = { saveMessage, getHistory, generateReply };
