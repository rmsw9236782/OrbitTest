import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import handler from "../api/chat.js";

function mockRes() {
  return {
    statusCode: 0, headers: {}, body: "",
    setHeader(k, v) { this.headers[k] = v; },
    end(b) { this.body = b; },
    json() { return JSON.parse(this.body); },
  };
}
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; delete process.env.GROQ_API_KEY; delete process.env.GROQ_MODEL; });

test("405 on GET", async () => {
  const res = mockRes();
  await handler({ method: "GET" }, res);
  assert.equal(res.statusCode, 405);
});

test("500 with a clear message when GROQ_API_KEY is missing", async () => {
  const res = mockRes();
  await handler({ method: "POST", body: { messages: [{ role: "user", content: "hi" }] } }, res);
  assert.equal(res.statusCode, 500);
  assert.match(res.json().error, /GROQ_API_KEY/);
});

test("forwards bounded messages with system prompt and configured model", async () => {
  process.env.GROQ_API_KEY = "test-key";
  process.env.GROQ_MODEL = "custom-model";
  let sent;
  globalThis.fetch = async (url, opts) => {
    sent = { url, opts, body: JSON.parse(opts.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: "Hello!" } }] }), { status: 200 });
  };
  const res = mockRes();
  await handler({ method: "POST", body: { messages: [{ role: "user", content: "hi" }] } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().reply, "Hello!");
  assert.equal(sent.body.model, "custom-model");
  assert.equal(sent.body.messages[0].role, "system");
  assert.equal(sent.opts.headers.Authorization, "Bearer test-key");
  assert.ok(sent.opts.signal, "uses an abort signal for timeouts");
});

test("maps Groq errors to friendly messages", async () => {
  process.env.GROQ_API_KEY = "bad";
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "Invalid API Key" } }), { status: 401 });
  const res = mockRes();
  await handler({ method: "POST", body: { messages: [{ role: "user", content: "hi" }] } }, res);
  assert.equal(res.statusCode, 502);
  assert.match(res.json().error, /rejected the API key/);
});

test("504 on timeout", async () => {
  process.env.GROQ_API_KEY = "k";
  globalThis.fetch = async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; };
  const res = mockRes();
  await handler({ method: "POST", body: { messages: [{ role: "user", content: "hi" }] } }, res);
  assert.equal(res.statusCode, 504);
});
