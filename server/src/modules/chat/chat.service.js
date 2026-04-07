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

async function ragAnswer(userQuery, articleText) {
  console.log(`Starting RAG pipeline for query: "${userQuery}"`);

  const chunks = await chunkText(articleText);
  console.log(`Split article into ${chunks.length} chunks.`);

  const topChunks = await findRelevantChunks(userQuery, chunks);
  console.log(`Found top ${topChunks.length} relevant chunks.`);

  const excerpts = topChunks
    .map((c, i) => `[Excerpt ${i + 1}]:\n${c}`)
    .join("\n\n");

  const ragCompletion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: `You are a helpful research assistant. Answer the user's question based STRICTLY on the following Wikipedia excerpts. If the answer is not contained in the excerpts, say "I couldn't find that information in the article." Do not use any outside knowledge. Answer directly and naturally. NEVER start your answer with "According to the excerpt" or "Based on the text". Just provide the facts.\n\nExcerpts:\n${excerpts}`,
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

// ── Execute a single tool call and return the article text if fetched ───

async function executeTool(toolCall, groqMessages, userQuery) {
  const { name } = toolCall.function;
  const args = JSON.parse(toolCall.function.arguments);

  console.log(`Tool call: ${name}(${JSON.stringify(args)})`);

  if (name === "search_wikipedia_query") {
    const results = await searchWikipedia(args.query);
    console.log(`Wikipedia search returned ${results.length} results.`);

    groqMessages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify(results),
    });
    return null; // no article yet
  }

  if (name === "get_wikipedia_article") {
    const articleText = await getWikipediaArticle(args.title);
    console.log(`Fetched article "${args.title}" (${articleText.length} chars). Starting RAG...`);

    // ── THIS IS THE KEY CHANGE: run RAG instead of returning a placeholder ──
    const answer = await ragAnswer(userQuery, articleText);
    return answer;
  }

  return null;
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

// ── Main reply generator with tool-calling loop ─────────────────────────

async function generateReply(history) {
  // Extract the user's original question (last user message)
  const userQuery =
    [...history].reverse().find((m) => m.sender === "user")?.text ?? "";

  // Resolve pronouns / coreferences into a standalone query
  const standaloneQuery = await rewriteQuery(history);
  console.log(`Original: "${userQuery}" | Standalone: "${standaloneQuery}"`);

  const systemMessage = {
    role: "system",
    content: `You are a helpful Wikipedia Research Assistant. Today's date is ${new Date().toISOString()}.

- For factual or historical questions: You must call the "search_wikipedia_query" function to find the answer. Do not guess from your own knowledge.
- For general conversation (like "hello", "thank you", or "ok"): Reply naturally in plain text without calling any functions.
- Past history: The facts in the conversation history are already verified. You do not need to research them again.`,
  };

  const groqMessages = [
    systemMessage,
    ...history.map((m) => ({
      role: m.sender === "user" ? "user" : "assistant",
      content: m.text,
    })),
  ];

  // ── First Groq call ───────────────────────────────────────────────────
  const completion = await callGroq(groqMessages);
  const choice = completion.choices[0];

  if (!choice?.message) {
    return { text: "No response generated.", toolCalls: null };
  }

  const assistantMessage = choice.message;

  // No tool calls — plain text response (greetings, etc.)
  if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
    return {
      text: assistantMessage.content ?? "No response generated.",
      toolCalls: null,
    };
  }

  // ── Process first round of tool calls ─────────────────────────────────
  groqMessages.push(assistantMessage);

  for (const toolCall of assistantMessage.tool_calls) {
    const ragResult = await executeTool(toolCall, groqMessages, standaloneQuery);
    if (ragResult) {
      // RAG completed — return the final answer directly
      return { text: ragResult, toolCalls: null };
    }
  }

  // ── Second Groq call (after search results) ───────────────────────────
  const followUp = await callGroq(groqMessages);
  const followUpChoice = followUp.choices[0];

  if (!followUpChoice?.message) {
    return { text: "No response generated.", toolCalls: null };
  }

  const followUpMessage = followUpChoice.message;

  // Model may now call get_wikipedia_article
  if (followUpMessage.tool_calls && followUpMessage.tool_calls.length > 0) {
    groqMessages.push(followUpMessage);

    for (const toolCall of followUpMessage.tool_calls) {
      const ragResult = await executeTool(toolCall, groqMessages, standaloneQuery);
      if (ragResult) {
        return { text: ragResult, toolCalls: null };
      }
    }
  }

  // Model responded with text after seeing search results
  return {
    text: followUpMessage.content ?? "No response generated.",
    toolCalls: null,
  };
}

module.exports = { saveMessage, getHistory, generateReply };
