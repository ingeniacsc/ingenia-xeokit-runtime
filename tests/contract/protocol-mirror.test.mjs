import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  BIM_VIEWPORT_MESSAGE_TYPES,
  BIM_VIEWPORT_PROTOCOL,
  assessProtocolCompatibility,
  assessProtocolMessage,
  createProtocolEnvelope,
  createProtocolRateLimiter,
  resolveProtocolTransition,
  validateProtocolEnvelope,
} from "../../packages/protocol/src/index.js";

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function context(overrides = {}) {
  return {
    expectedOrigin: "https://host.example",
    expectedWindow: {},
    sessionId: "session.1234567890",
    nonce: "nonce.123456789012",
    stateRevision: 0,
    state: "created",
    seenMessageIds: new Set(),
    ...overrides,
  };
}

test("public protocol inventory and transitions are self-contained", () => {
  assert.equal(BIM_VIEWPORT_PROTOCOL, "ingenia.generic-bim-viewport");
  assert.equal(new Set(BIM_VIEWPORT_MESSAGE_TYPES).size, BIM_VIEWPORT_MESSAGE_TYPES.length);
  for (const [state, source, type] of [
    ["created", "viewer", "viewer.ready"],
    ["viewer_ready", "host", "host.initialize"],
    ["initializing", "viewer", "viewer.initialized"],
    ["active", "host", "model.open"],
    ["active", "viewer", "context.lost"],
    ["context_lost", "host", "context.restore-requested"],
  ]) {
    assert.equal(resolveProtocolTransition(state, source, type).ok, true);
  }
  assert.equal(assessProtocolCompatibility("1.1.0").ok, true);
});

test("schema and runtime use the same complete message inventory", async () => {
  const schema = JSON.parse(await readFile(
    path.join(runtimeRoot, "packages/protocol/schemas/message.schema.json"),
    "utf8",
  ));
  assert.deepEqual(schema.$defs.messageType.enum, BIM_VIEWPORT_MESSAGE_TYPES);
});

test("generated envelopes satisfy bounded runtime validation", () => {
  const envelope = createProtocolEnvelope({
    sessionId: "session.1234567890",
    nonce: "nonce.123456789012",
    stateRevision: 0,
    source: "viewer",
    type: "viewer.ready",
    payload: {},
  });
  assert.equal(validateProtocolEnvelope(envelope).ok, true);
});

test("identifier-bearing envelopes fail closed before dispatch", () => {
  const envelope = createProtocolEnvelope({
    sessionId: "session.1234567890",
    nonce: "nonce.123456789012",
    stateRevision: 3,
    source: "host",
    type: "selection.select",
    payload: { identifiers: ["opaque_identifier_0001", "opaque_identifier_0001"] },
  });
  const validation = validateProtocolEnvelope(envelope);
  assert.equal(validation.ok, false);
  assert.equal(validation.error.code, "INVALID_IDENTIFIER_LIST");
});

test("message assessment fails closed without replay state", () => {
  const expectedWindow = {};
  const envelope = createProtocolEnvelope({
    sessionId: "session.1234567890",
    nonce: "nonce.123456789012",
    stateRevision: 0,
    source: "viewer",
    type: "viewer.ready",
    payload: {},
  });
  const result = assessProtocolMessage(
    { origin: "https://host.example", source: expectedWindow, data: envelope },
    context({ expectedWindow, seenMessageIds: undefined }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "MISSING_REPLAY_STATE");
});

test("public rate limiter enforces the reviewed bounded message window", () => {
  const limiter = createProtocolRateLimiter({ windowMs: 1_000, maxMessages: 2 });
  assert.equal(limiter.attempt(0).ok, true);
  assert.equal(limiter.attempt(1).ok, true);
  assert.equal(limiter.attempt(2).error.code, "RATE_LIMITED");
  assert.equal(limiter.attempt(1_001).ok, true);
});
