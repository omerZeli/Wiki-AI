const { pool } = require("../../config/db");
const groq = require("../../config/groq");

const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";

const MAX_RETRIES = 1;

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
    snippet: snippet.replace(/<[^>]+>/g, ""), // strip HTML tags
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

// ── Main reply generator with tool-calling loop ─────────────────────────

async function generateReply(history) {
  const systemMessage = {
    role: "system",
    content: `You are a strict Wikipedia Research Agent. Today's date is ${new Date().toISOString()}.

CRITICAL RULES:
1. You are STRICTLY FORBIDDEN from answering any factual, historical, or general knowledge questions using your internal training data.
2. Even if you are 100% certain of the answer, you MUST use the 'search_wikipedia_query' tool to search for it first.
3. FORMATTING RULE: You must use the native JSON tool calling API. NEVER output raw text, pseudo-code, or XML tags (e.g., <function=...>).
4. You may answer normally with standard text ONLY for basic conversational greetings (e.g., "hello", "how are you"). For any factual inquiry, trigger the tool properly.`,
  };

  const groqMessages = [
    systemMessage,
    ...history.map((m) => ({
      role: m.sender === "user" ? "user" : "assistant",
      content: m.text,
    })),
  ];

  // First Groq call
  const completion = await callGroq(groqMessages);

  const choice = completion.choices[0];
  if (!choice?.message) {
    return { text: "No response generated.", toolCalls: null };
  }

  const assistantMessage = choice.message;

  // No tool calls — plain text response
  if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
    return { text: assistantMessage.content ?? "No response generated.", toolCalls: null };
  }

  // ── Tool-calling loop ──────────────────────────────────────────────────
  // Append the assistant's tool-call message so Groq sees the full chain
  groqMessages.push(assistantMessage);

  for (const toolCall of assistantMessage.tool_calls) {
    const { name } = toolCall.function;
    const args = JSON.parse(toolCall.function.arguments);

    console.log(`The model wants to call ${name} with arguments: ${JSON.stringify(args)}`);

    if (name === "search_wikipedia_query") {
      const results = await searchWikipedia(args.query);
      console.log(`Wikipedia search for "${args.query}" returned ${results.length} results.`);

      // Feed the small search results back as a tool response
      groqMessages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(results),
      });
    } else if (name === "get_wikipedia_article") {
      const articleText = await getWikipediaArticle(args.title);
      console.log(`Fetched full article: ${args.title}. Length: ${articleText.length} characters.`);

      // CRITICAL STOP — do NOT send the massive text back to Groq
      return {
        text: "Wikipedia article fetched successfully. Ready for RAG processing.",
        toolCalls: assistantMessage.tool_calls,
        isSearching: false,
        articleLength: articleText.length,
      };
    }
  }

  // Second Groq call — after search results have been appended
  const followUp = await callGroq(groqMessages);

  const followUpChoice = followUp.choices[0];
  if (!followUpChoice?.message) {
    return { text: "No response generated.", toolCalls: null };
  }

  const followUpMessage = followUpChoice.message;

  // The model may now call get_wikipedia_article
  if (followUpMessage.tool_calls && followUpMessage.tool_calls.length > 0) {
    for (const toolCall of followUpMessage.tool_calls) {
      const { name } = toolCall.function;
      const args = JSON.parse(toolCall.function.arguments);

      console.log(`The model wants to call ${name} with arguments: ${JSON.stringify(args)}`);

      if (name === "get_wikipedia_article") {
        const articleText = await getWikipediaArticle(args.title);
        console.log(`Fetched full article: ${args.title}. Length: ${articleText.length} characters.`);

        return {
          text: "Wikipedia article fetched successfully. Ready for RAG processing.",
          toolCalls: followUpMessage.tool_calls,
          isSearching: false,
          articleLength: articleText.length,
        };
      }
    }
  }

  // If the model just responded with text after seeing search results
  return {
    text: followUpMessage.content ?? "No response generated.",
    toolCalls: null,
  };
}

module.exports = { saveMessage, getHistory, generateReply };
