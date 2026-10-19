// Vercel serverless function: proxies chat requests to Groq.
// The API key stays here, on the server, read from process.env.GROQ_API_KEY.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

const MAX_MESSAGES = 20; // bounded history sent to the model
const MAX_MESSAGE_CHARS = 4000; // per-message input limit
const MAX_TOTAL_CHARS = 24000; // whole-conversation limit
const TIMEOUT_MS = 30000;

const SYSTEM_PROMPT =
  "You are Orbit, a friendly, helpful general-purpose assistant. " +
  "Answer questions on any topic, help write and edit content, brainstorm ideas, " +
  "and explain concepts clearly. Use follow-up context from the conversation. " +
  "Be concise by default and use Markdown (lists, **bold**, `code`, fenced code blocks) when it helps readability. " +
  "If you are unsure, say so rather than inventing facts.";

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body !== undefined) {
    return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
  }
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 200000) throw new Error("too_large");
  }
  return JSON.parse(raw || "{}");
}

// Returns a cleaned, bounded message list or an error string.
export function sanitizeMessages(input) {
  if (!Array.isArray(input) || input.length === 0) {
    return { error: "Send at least one message." };
  }
  const cleaned = [];
  for (const m of input) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") {
      return { error: "Messages must have a role of 'user' or 'assistant' and text content." };
    }
    const content = m.content.trim();
    if (!content) continue;
    if (content.length > MAX_MESSAGE_CHARS) {
      return { error: `Each message must be ${MAX_MESSAGE_CHARS} characters or fewer.` };
    }
    cleaned.push({ role: m.role, content });
  }
  if (cleaned.length === 0 || cleaned[cleaned.length - 1].role !== "user") {
    return { error: "The last message must be from the user." };
  }

  // Keep only the most recent messages, then trim further to the total budget.
  let recent = cleaned.slice(-MAX_MESSAGES);
  let total = recent.reduce((n, m) => n + m.content.length, 0);
  while (total > MAX_TOTAL_CHARS && recent.length > 1) {
    total -= recent[0].content.length;
    recent = recent.slice(1);
  }
  // History should start with a user turn.
  while (recent.length > 1 && recent[0].role !== "user") recent = recent.slice(1);
  return { messages: recent };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return sendJson(res, 500, {
      error: "The server is missing GROQ_API_KEY. Add it as an environment variable and redeploy.",
    });
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    return sendJson(res, 400, { error: "Request body must be valid JSON." });
  }

  const result = sanitizeMessages(body && body.messages);
  if (result.error) return sendJson(res, 400, { error: result.error });

  const model = (process.env.GROQ_MODEL || "").trim() || DEFAULT_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const groqRes = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...result.messages],
        temperature: 0.7,
        max_tokens: 1024,
      }),
      signal: controller.signal,
    });

    const data = await groqRes.json().catch(() => null);

    if (!groqRes.ok) {
      const detail = data && data.error && data.error.message;
      const status = groqRes.status === 429 ? 429 : 502;
      const message =
        groqRes.status === 401
          ? "Groq rejected the API key. Check GROQ_API_KEY."
          : groqRes.status === 429
            ? "Orbit is getting too many requests right now. Wait a moment and try again."
            : `Groq returned an error${detail ? `: ${detail}` : "."}`;
      return sendJson(res, status, { error: message });
    }

    const reply = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : "";
    if (!reply) return sendJson(res, 502, { error: "Groq returned an empty response." });

    return sendJson(res, 200, { reply, model });
  } catch (err) {
    if (err && err.name === "AbortError") {
      return sendJson(res, 504, { error: "The request to Groq timed out. Please try again." });
    }
    return sendJson(res, 502, { error: "Could not reach Groq. Please try again." });
  } finally {
    clearTimeout(timer);
  }
}
