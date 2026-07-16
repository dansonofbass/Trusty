import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pendingConfirm,
  trimTranscript,
  type AgentMessage,
} from "../src/agent";

const user = (content: string): AgentMessage => ({ role: "user", content });
const assistant = (
  content: string,
  toolCalls?: { id: string; name: string; args: unknown }[],
): AgentMessage => ({ role: "assistant", content, toolCalls });
const tool = (toolCallId: string, name: string, content: string): AgentMessage => ({
  role: "tool",
  toolCallId,
  name,
  content,
});

test("pendingConfirm: null on empty / plain-text transcripts", () => {
  assert.equal(pendingConfirm([]), null);
  assert.equal(pendingConfirm([user("hi"), assistant("hello")]), null);
});

test("pendingConfirm: finds the unanswered tool call in the last assistant turn", () => {
  const t = [
    user("i need a lawyer, ask my people"),
    assistant("", [{ id: "c1", name: "create_ask", args: { topic: "lawyer" } }]),
  ];
  assert.deepEqual(pendingConfirm(t), { id: "c1", name: "create_ask", args: { topic: "lawyer" } });
});

test("pendingConfirm: answered calls are not pending", () => {
  const t = [
    user("who fixes teeth?"),
    assistant("", [{ id: "c1", name: "trust_search", args: { query: "dentist" } }]),
    tool("c1", "trust_search", "2 results"),
    assistant("Maria and Ana are trusted."),
  ];
  assert.equal(pendingConfirm(t), null);
});

test("pendingConfirm: parallel calls — first unanswered wins", () => {
  const t = [
    user("search and save"),
    assistant("", [
      { id: "c1", name: "trust_search", args: {} },
      { id: "c2", name: "create_ask", args: {} },
    ]),
    tool("c1", "trust_search", "0 results"),
  ];
  assert.equal(pendingConfirm(t)?.id, "c2");
});

test("trimTranscript: returns transcript unchanged when under budget", () => {
  const t = [user("a"), assistant("b")];
  assert.equal(trimTranscript(t, 60_000), t);
});

test("trimTranscript: drops oldest first, keeps the tail", () => {
  const t = [user("x".repeat(500)), assistant("y".repeat(500)), user("z".repeat(100))];
  const out = trimTranscript(t, 300);
  assert.ok(out.length < t.length);
  assert.equal(out[out.length - 1], t[t.length - 1]);
});

test("trimTranscript: never starts on a dangling tool result", () => {
  const t = [
    user("q".repeat(400)),
    assistant("", [{ id: "c1", name: "trust_search", args: {} }]),
    tool("c1", "trust_search", "r".repeat(400)),
    user("follow-up"),
    assistant("answer"),
  ];
  const out = trimTranscript(t, 200);
  assert.notEqual(out[0].role, "tool");
  assert.equal(out[out.length - 1], t[t.length - 1]);
});
