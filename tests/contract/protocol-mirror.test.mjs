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
  assert.equal(BIM_VIEWPORT_MESSAGE_TYPES.includes("spatial.section.flip"), true);
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

test("context-menu messages require a bounded anchor and allowlisted match scope", () => {
  const contextMenu = createProtocolEnvelope({
    sessionId: "session.1234567890",
    nonce: "nonce.123456789012",
    stateRevision: 3,
    source: "viewer",
    type: "selection.context-menu",
    payload: {
      identifiers: ["opaque_identifier_0001"],
      anchor: { x: 0.5, y: 0.25 },
      modelVersionId: "12345678-1234-4123-8123-123456789012",
    },
  });
  assert.equal(validateProtocolEnvelope(contextMenu).ok, true);

  const invalidAttribution = createProtocolEnvelope({
    ...contextMenu,
    messageId: "message.invalid-attribution",
    payload: { ...contextMenu.payload, modelVersionId: "bad id" },
  });
  assert.equal(validateProtocolEnvelope(invalidAttribution).ok, false);

  const invalidMatch = createProtocolEnvelope({
    sessionId: "session.1234567890",
    nonce: "nonce.123456789012",
    stateRevision: 3,
    source: "host",
    type: "selection.match",
    payload: { identifiers: ["opaque_identifier_0001"], scope: "unknown" },
  });
  assert.equal(validateProtocolEnvelope(invalidMatch).ok, false);
});

test("measurement and multi-selection commands are explicitly bounded", () => {
  const multiMode = createProtocolEnvelope({
    sessionId: "session.1234567890",
    nonce: "nonce.123456789012",
    stateRevision: 3,
    source: "host",
    type: "selection.mode",
    payload: { mode: "multi" },
  });
  const measurementMode = createProtocolEnvelope({
    sessionId: "session.1234567890",
    nonce: "nonce.123456789012",
    stateRevision: 3,
    source: "host",
    type: "measurement.mode",
    payload: { enabled: true },
  });
  const measurementResult = createProtocolEnvelope({
    sessionId: "session.1234567890",
    nonce: "nonce.123456789012",
    stateRevision: 3,
    source: "viewer",
    type: "measurement.changed",
    payload: { status: "complete", distance: 12.345678 },
  });
  const invalidResult = createProtocolEnvelope({
    ...measurementResult,
    messageId: "message.invalid.123456",
    type: "measurement.changed",
    payload: { status: "complete", distance: Number.POSITIVE_INFINITY },
  });

  assert.equal(validateProtocolEnvelope(multiMode).ok, true);
  assert.equal(validateProtocolEnvelope(measurementMode).ok, true);
  assert.equal(validateProtocolEnvelope(measurementResult).ok, true);
  assert.equal(validateProtocolEnvelope(invalidResult).ok, false);
});

test("visible selection requires an authorized seed and orbit pivot is bounded", () => {
  const visibleSelection = createProtocolEnvelope({
    sessionId: "session.1234567890",
    nonce: "nonce.123456789012",
    stateRevision: 3,
    source: "host",
    type: "selection.visible",
    payload: { identifiers: ["opaque_identifier_0001"] },
  });
  const orbitPivot = createProtocolEnvelope({
    sessionId: "session.1234567890",
    nonce: "nonce.123456789012",
    stateRevision: 3,
    source: "host",
    type: "camera.navigation",
    payload: { mode: "orbit", orbitPivotEnabled: true },
  });
  const unseededSelection = createProtocolEnvelope({
    ...visibleSelection,
    messageId: "message.visible.unseeded",
    payload: {},
  });
  const invalidPivot = createProtocolEnvelope({
    ...orbitPivot,
    messageId: "message.pivot.invalid",
    payload: { mode: "orbit", orbitPivotEnabled: "yes" },
  });

  assert.equal(validateProtocolEnvelope(visibleSelection).ok, true);
  assert.equal(validateProtocolEnvelope(orbitPivot).ok, true);
  assert.equal(validateProtocolEnvelope(unseededSelection).ok, false);
  assert.equal(validateProtocolEnvelope(invalidPivot).ok, false);
});

test("labels and model tree commands are explicitly bounded", () => {
  const labels = createProtocolEnvelope({
    sessionId: "session.1234567890",
    nonce: "nonce.123456789012",
    stateRevision: 3,
    source: "host",
    type: "labels.mode",
    payload: { enabled: true, identifiers: ["opaque_identifier_0001"] },
  });
  const tree = createProtocolEnvelope({
    sessionId: "session.1234567890",
    nonce: "nonce.123456789012",
    stateRevision: 3,
    source: "host",
    type: "tree.mode",
    payload: { open: true },
  });
  const treeChanged = createProtocolEnvelope({
    sessionId: "session.1234567890",
    nonce: "nonce.123456789012",
    stateRevision: 3,
    source: "viewer",
    type: "tree.changed",
    payload: { open: false },
  });
  const tooManyLabels = createProtocolEnvelope({
    ...labels,
    messageId: "message.labels.too-many",
    payload: {
      enabled: true,
      identifiers: Array.from(
        { length: 81 },
        (_, index) => "opaque_identifier_" + String(index).padStart(4, "0"),
      ),
    },
  });

  assert.equal(validateProtocolEnvelope(labels).ok, true);
  assert.equal(validateProtocolEnvelope(tree).ok, true);
  assert.equal(validateProtocolEnvelope(treeChanged).ok, true);
  assert.equal(validateProtocolEnvelope(tooManyLabels).ok, false);
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
