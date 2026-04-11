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

async function embedBatch(texts) {
  const model = await getEmbedder();
  // Pass the entire array of texts at once for optimized backend batching
  const output = await model(texts, { pooling: "mean", normalize: true });
  return output.tolist();
}

// ── In-Memory RAG helpers ───────────────────────────────────────────────

async function chunkText(text) {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });
  return splitter.splitText(text);
}

async function findRelevantChunks(query, chunks, topK = 8) {
  const model = await getEmbedder();

  // 1. Embed the user query
  const queryOutput = await model(query, { pooling: "mean", normalize: true });
  const queryEmbedding = queryOutput.tolist()[0];

  // 2. Embed ALL chunks in a single batch call! (Significantly faster)
  const chunkEmbeddings = await embedBatch(chunks);

  // 3. Calculate cosine similarity
  const scored = chunks.map((chunk, i) => ({
    text: chunk,
    score: cosineSimilarity(queryEmbedding, chunkEmbeddings[i]),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((s) => s.text);
}

async function ragAnswer(userQuery, articleText, articleTitle) {
  console.log(`Starting RAG pipeline for query: "${userQuery}"`);

  const chunks = await chunkText(articleText);
  console.log(`Split article into ${chunks.length} chunks.`);

  // SAFETY GUARD: Prevent Transformers.js crash if the article is empty or splitting yielded no chunks
  if (chunks.length === 0) {
    console.log("No chunks to embed. Returning INFORMATION_NOT_FOUND.");
    return "INFORMATION_NOT_FOUND";
  }

  const topChunks = await findRelevantChunks(userQuery, chunks, 8);
  console.log(`Found top ${topChunks.length} relevant chunks.`);

  const excerpts = topChunks
    .map((c, i) => `[Excerpt ${i + 1} from article "${articleTitle}"]:\n${c}`)
    .join("\n\n");

  const ragCompletion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: `You are an expert encyclopedic researcher.

Answer the user's question comprehensively and in detail, based STRICTLY on the provided text.
If the user asks a broad question (e.g., about events, summaries, or details), synthesize the information into a rich, well-structured paragraph or bulleted list.
If the exact answer is not contained in the text, respond with exactly "INFORMATION_NOT_FOUND" and nothing else.

CRITICAL RULES:
1. BLIND TRUST: Treat the text as the absolute truth.
2. COMPREHENSIVE BUT GROUNDED: Provide as much detail as possible. NEVER invent facts outside the text.
3. NO META-TALK: NEVER mention your knowledge cutoff, training data, or internal limitations.
4. NO DISCLAIMERS: NEVER add disclaimers about information changing.
5. AUTHORITATIVE TONE (CRITICAL): NEVER refer to "the excerpts", "the text", "the article", "the provided information", or the fact that you are reading from a source. NEVER use phrases like "According to the provided information..." or "Based on the text...". Simply state the facts directly and confidently as if you know them natively.

Excerpts:\n${excerpts}`,
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

const WIKI_HEADERS = {
  "User-Agent": "MyRAGBot/1.0 (contact@example.com)",
};

async function searchWikipedia(query) {
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: "3",
    format: "json",
    origin: "*",
  });

  const res = await fetch(`${WIKIPEDIA_API}?${params}`, { headers: WIKI_HEADERS });
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

  const res = await fetch(`${WIKIPEDIA_API}?${params}`, { headers: WIKI_HEADERS });
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
       LIMIT 6
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
  // OPTIMIZATION: If this is the first message (or empty), there is no context to resolve.
  // Bypass the LLM entirely to save an API call and reduce latency!
  if (history.length <= 1) {
    console.log("Bypassing rewriteQuery LLM call (no context).");
    return history[history.length - 1]?.text ?? "";
  }

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
1. Output ONLY the final rewritten question/statement.
2. NEVER add conversational filler (e.g., "I don't have information").
3. CONVERSATIONAL MESSAGES: If the user's message is a greeting, thanks, or simple acknowledgment (e.g., "thank you", "hello", "ok"), DO NOT use previous context. Output the exact message.
4. If there is no previous context, just repeat the user's question exactly.

EXAMPLES:
User: who is the current president?
Output: Who is the current president?

User: when was he born?
Output: When was he born?

User: thank you
Output: thank you`,
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
    content: `You are a strict data-routing API. You are NOT a conversational AI, but you are permitted to be polite.

Research Protocol:
1. ALLOWED TOOLS: You may ONLY use 'search_wikipedia_query' and 'get_wikipedia_article'.
2. ENTITY SEARCH ONLY: Search ONLY for broad Wikipedia entities.
3. EXACT TITLE COPY-PASTE (CRITICAL): When calling 'get_wikipedia_article', you MUST use the EXACT title string returned in the search results. NEVER manually add disambiguation tags (e.g., DO NOT append "(TV series)" or "(film)" if it wasn't exactly in the JSON). Trust the exact string provided by the search.
4. BLIND SNIPPETS: Search snippets DO NOT contain the answer. Their ONLY purpose is to give you a valid 'title' to fetch.
5. IMMEDIATE READING: If a search returns results, you MUST immediately call 'get_wikipedia_article' using an exact title from them. CONSECUTIVE SEARCHES ARE STRICTLY FORBIDDEN.
6. ESCAPE HATCH (EMPTY RESULTS): If a search returns NO results (empty array []), output EXACTLY: "Information not available in Wikipedia." Do the same if RAG returns "INFORMATION_NOT_FOUND".
7. NO META-EXPLANATIONS: NEVER discuss tools, functions, or parameters.
8. STRICT PASS-THROUGH: Output exactly the text from the tool. Do not add notes.
9. SMALL TALK: If the user says thanks or hello, reply politely without tools.`,
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
        // Parse the arguments to get the exact article title
        const args = JSON.parse(toolCall.function.arguments);
        const articleTitle = args.title;

        // Format title for Wikipedia URL (replace spaces with underscores)
        const urlTitle = encodeURIComponent(articleTitle.replace(/ /g, "_"));
        const wikipediaUrl = `https://en.wikipedia.org/wiki/${urlTitle}`;

        // Append the source link beautifully using Markdown
        const finalResponse = `${resultText}\n\n**Sources:**\n* [${articleTitle}](${wikipediaUrl})`;

        return {
          text: finalResponse,
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
