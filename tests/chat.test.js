import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeMessages } from "../api/chat.js";

test("rejects empty or malformed input", () => {
  assert.ok(sanitizeMessages([]).error);
  assert.ok(sanitizeMessages("hi").error);
  assert.ok(sanitizeMessages([{ role: "system", content: "x" }]).error);
  assert.ok(sanitizeMessages([{ role: "assistant", content: "hi" }]).error);
});

test("rejects over-long messages", () => {
  assert.ok(sanitizeMessages([{ role: "user", content: "a".repeat(4001) }]).error);
});

test("bounds history to the most recent messages", () => {
  const msgs = [];
  for (let i = 0; i < 50; i++) msgs.push({ role: i % 2 ? "assistant" : "user", content: "m" + i });
  msgs.push({ role: "user", content: "last" });
  const { messages } = sanitizeMessages(msgs);
  assert.ok(messages.length <= 20);
  assert.equal(messages[0].role, "user");
  assert.equal(messages.at(-1).content, "last");
});

test("trims to the total character budget", () => {
  const big = "x".repeat(3900);
  const msgs = [];
  for (let i = 0; i < 9; i++) msgs.push({ role: "user", content: big }, { role: "assistant", content: big });
  msgs.push({ role: "user", content: "q" });
  const { messages } = sanitizeMessages(msgs);
  const total = messages.reduce((n, m) => n + m.content.length, 0);
  assert.ok(total <= 24000);
  assert.equal(messages[0].role, "user");
});
