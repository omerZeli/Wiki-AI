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
        content: `You are a strict data extractor.

Answer the user's question based STRICTLY on the following Wikipedia excerpts from the article titled "${articleTitle}". If the exact answer is not contained in the excerpts, respond with exactly "INFORMATION_NOT_FOUND" and nothing else.

CRITICAL RULES:
1. BLIND TRUST: Treat the text as the absolute truth. If the text says someone is the "current" president, accept it as the current reality regardless of the actual year.
2. NEVER mention your "knowledge cutoff", training data, or internal limitations.
3. NEVER add disclaimers about information being subject to change.
4. Output ONLY the clear facts found directly in the text.\n\nExcerpts:\n${excerpts}`,
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
        "Searches Wikipedia for relevant article titles based on keywords. Always use this first to find exact titles.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search keywords.",
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
        "Fetches the full text of a Wikipedia article. CRITICAL: You must pass ONLY a single exact article title as a string. NEVER pass an array of multiple results.",
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
    redirects: "1",
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
        model: "llama-3.1-8b-instant",
        messages,
        tools,
        tool_choice: toolChoice,
        parallel_tool_calls: false,
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
    model: "llama-3.1-8b-instant",
    messages: [
      {
        role: "system",
        content: `You are a strict NLP query rewriter. Rewrite the user's latest message into a standalone string.

CRITICAL RULES:
1. Output ONLY the final rewritten question.
2. NEVER add conversational filler (e.g., "I don't have information", "The rewritten question is:").
3. If there is no previous context, just repeat the user's question exactly.

EXAMPLES:
User: who is the current president?
Output: Who is the current president?

User: when was he born?
Output: When was he born? (Or resolve 'he' if context exists)`,
      },
      ...mapped,
    ],
  });

  return result.choices[0]?.message?.content?.trim() ?? "";
}

// ── Main reply generator with agentic ReAct loop ────────────────────────

async function generateReply(history) {
  const MAX_ITERATIONS = 8;

  // Extract the user's original question (last user message)
  const userQuery =
    [...history].reverse().find((m) => m.sender === "user")?.text ?? "";

  // Resolve pronouns / coreferences into a standalone query
  const standaloneQuery = await rewriteQuery(history);
  console.log(`Original: "${userQuery}" | Standalone: "${standaloneQuery}"`);

  const systemMessage = {
    role: "system",
    content: `You are a strict data-routing API. You are NOT a conversational AI.

Research Protocol:
1. ALLOWED TOOLS: You have EXACTLY TWO tools available: 'search_wikipedia_query' and 'get_wikipedia_article'. Any attempt to call a different tool will crash the system.
2. YOU MUST READ: Search snippets do NOT contain the answer. After a search, you MUST use 'get_wikipedia_article' to read the main conceptual article (e.g., "President of the United States"). AVOID "List of..." articles.
3. ANTI-LAZY RULE: If the tool returns "INFORMATION_NOT_FOUND", search again with new keywords.
4. NO INNER MONOLOGUE: Do not narrate your thought process.
5. STRICT PASS-THROUGH (CRITICAL): Once the tool returns the factual answer, output exactly that text. Do not add warnings, notes, knowledge cutoffs, or disclaimers.`,
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

      // SHORT-CIRCUIT: If the RAG pipeline found the answer, return it immediately to the user!
      // This bypasses the 8B model's RLHF disclaimers entirely.
      if (toolCall.function.name === "get_wikipedia_article" && !resultText.includes("INFORMATION_NOT_FOUND")) {
        return {
          text: resultText,
          toolCalls: null,
        };
      }

      // If it was just a search, or if the info was not found, feed it back to the loop
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
