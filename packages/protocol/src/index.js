// SPDX-License-Identifier: MIT

export const BIM_VIEWPORT_PROTOCOL = "ingenia.generic-bim-viewport";
export const BIM_VIEWPORT_PROTOCOL_VERSION = "1.0.0";
export const BIM_VIEWPORT_MAX_MESSAGE_BYTES = 64 * 1024;
export const BIM_VIEWPORT_MAX_IDENTIFIERS = 5_000;
export const BIM_VIEWPORT_MAX_CLOCK_SKEW_MS = 30_000;
export const BIM_VIEWPORT_RATE_LIMIT = Object.freeze({ windowMs: 1_000, maxMessages: 120 });

export const BIM_VIEWPORT_MESSAGE_TYPES = Object.freeze([
  "viewer.ready", "host.initialize", "viewer.initialized", "handshake.rejected",
  "request.ack", "request.error", "request.cancel",
  "model.open", "model.add", "model.remove", "model.replace",
  "model.progress", "model.ready", "model.failed", "model.revision",
  "camera.set", "camera.get", "camera.fit", "camera.view",
  "camera.navigation", "camera.day-night", "camera.changed", "navigation.changed",
  "selection.select", "selection.clear", "selection.marquee", "selection.changed",
  "object.picked", "object.hovered",
  "visibility.show", "visibility.hide", "visibility.isolate", "visibility.reset",
  "visibility.applied", "filter.apply", "filter.cancel", "filter.progress",
  "filter.applied", "appearance.apply", "appearance.applied",
  "spatial.section.set", "spatial.section.clear", "spatial.storeys.set",
  "spatial.grid.set", "spatial.changed", "metadata.request", "metadata.result",
  "snapshot.capture", "snapshot.result", "session.export", "session.import",
  "session.state", "context.lost", "context.restore-requested", "context.restored",
  "context.restore-failed",
]);

const MESSAGE_TYPES = new Set(BIM_VIEWPORT_MESSAGE_TYPES);
const HOST_TYPES = new Set([
  "host.initialize", "request.cancel", "model.open", "model.add", "model.remove",
  "model.replace", "camera.set", "camera.get", "camera.fit", "camera.view",
  "camera.navigation", "camera.day-night", "selection.select", "selection.clear",
  "selection.marquee", "visibility.show", "visibility.hide", "visibility.isolate",
  "visibility.reset", "filter.apply", "filter.cancel", "appearance.apply",
  "spatial.section.set", "spatial.section.clear", "spatial.storeys.set",
  "spatial.grid.set", "metadata.request", "snapshot.capture", "session.export",
  "session.import", "context.restore-requested",
]);
const VIEWER_TYPES = new Set([
  "viewer.ready", "viewer.initialized", "model.progress", "model.ready",
  "model.failed", "model.revision", "camera.changed", "navigation.changed",
  "selection.changed", "object.picked", "object.hovered", "visibility.applied",
  "filter.progress", "filter.applied", "appearance.applied", "spatial.changed",
  "metadata.result", "snapshot.result", "session.state", "context.lost",
  "context.restored", "context.restore-failed",
]);
const BIDIRECTIONAL_TYPES = new Set(["handshake.rejected", "request.ack", "request.error"]);
const ALLOWED_KEYS = new Set([
  "protocol", "protocolVersion", "sessionId", "requestId", "messageId", "nonce",
  "sentAt", "source", "stateRevision", "type", "payload",
]);
const TRANSITIONS = Object.freeze({
  created: Object.freeze({ "viewer:viewer.ready": "viewer_ready" }),
  viewer_ready: Object.freeze({ "host:host.initialize": "initializing" }),
  initializing: Object.freeze({
    "viewer:viewer.initialized": "active",
    "viewer:handshake.rejected": "failed",
  }),
  active: Object.freeze({ "viewer:context.lost": "context_lost" }),
  context_lost: Object.freeze({ "host:context.restore-requested": "restoring" }),
  restoring: Object.freeze({
    "viewer:context.restored": "active",
    "viewer:context.restore-failed": "failed",
  }),
});
const ACTIVE_PREFIXES = [
  "request.", "model.", "camera.", "navigation.", "selection.", "object.",
  "visibility.", "filter.", "appearance.", "spatial.", "metadata.", "snapshot.",
  "session.",
];
const IDENTIFIER_LIST_MESSAGE_TYPES = new Set([
  "camera.fit", "selection.select", "selection.changed", "object.picked",
  "object.hovered", "visibility.show", "visibility.hide", "visibility.isolate",
  "appearance.apply",
]);

function fail(code, message, recoveryAction = "discard_message") {
  return Object.freeze({ ok: false, error: Object.freeze({ code, message, recoveryAction }) });
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isOpaqueIdentifier(value) {
  return typeof value === "string"
    && value.length >= 16
    && value.length <= 128
    && /^[A-Za-z0-9._~-]+$/.test(value);
}

export function estimateProtocolMessageBytes(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function parseProtocolVersion(version) {
  if (typeof version !== "string") return null;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) return null;
  return Object.freeze({ major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) });
}

export function assessProtocolCompatibility(candidate, supported = BIM_VIEWPORT_PROTOCOL_VERSION) {
  const candidateVersion = parseProtocolVersion(candidate);
  const supportedVersion = parseProtocolVersion(supported);
  if (!candidateVersion || !supportedVersion) {
    return fail("PROTOCOL_MISMATCH", "Protocol version must use semantic versioning.");
  }
  if (candidateVersion.major !== supportedVersion.major) {
    return fail("MAJOR_VERSION_MISMATCH", "Protocol major versions are incompatible.", "reload_iframe_cache_bust");
  }
  return Object.freeze({
    ok: true,
    compatible: true,
    negotiatedVersion: candidateVersion.minor <= supportedVersion.minor ? candidate : supported,
  });
}

export function createProtocolRateLimiter(options = {}) {
  const windowMs = options.windowMs ?? BIM_VIEWPORT_RATE_LIMIT.windowMs;
  const maxMessages = options.maxMessages ?? BIM_VIEWPORT_RATE_LIMIT.maxMessages;
  const acceptedAt = [];
  return Object.freeze({
    attempt(at = Date.now()) {
      while (acceptedAt.length > 0 && acceptedAt[0] <= at - windowMs) acceptedAt.shift();
      if (acceptedAt.length >= maxMessages) return fail("RATE_LIMITED", "Protocol message rate exceeds the configured limit.");
      acceptedAt.push(at);
      return Object.freeze({ ok: true, remaining: maxMessages - acceptedAt.length });
    },
    reset() {
      acceptedAt.length = 0;
    },
  });
}

export function resolveProtocolTransition(state, source, type) {
  if (state === "active" && ACTIVE_PREFIXES.some((prefix) => type.startsWith(prefix))) {
    return Object.freeze({ ok: true, nextState: "active" });
  }
  const nextState = TRANSITIONS[state]?.[`${source}:${type}`];
  return nextState
    ? Object.freeze({ ok: true, nextState })
    : fail("INVALID_TRANSITION", "Message is not valid in the current protocol state.");
}

export function validateIdentifierList(identifiers) {
  if (!Array.isArray(identifiers) || identifiers.length > BIM_VIEWPORT_MAX_IDENTIFIERS) {
    return fail("INVALID_IDENTIFIER_LIST", "Identifier list exceeds the protocol limit.");
  }
  if (identifiers.some((identifier) => !isOpaqueIdentifier(identifier))) {
    return fail("INVALID_IDENTIFIER_LIST", "Identifiers must be opaque bounded strings.");
  }
  if (new Set(identifiers).size !== identifiers.length) {
    return fail("INVALID_IDENTIFIER_LIST", "Identifier list must not contain duplicates.");
  }
  return Object.freeze({ ok: true, count: identifiers.length });
}

export function createProtocolEnvelope({ sessionId, nonce, stateRevision, source, type, payload = {} }) {
  const randomId = () => {
    const value = globalThis.crypto?.randomUUID?.();
    if (!isOpaqueIdentifier(value)) throw new Error("Secure opaque identifiers are unavailable.");
    return value;
  };
  return Object.freeze({
    protocol: BIM_VIEWPORT_PROTOCOL,
    protocolVersion: BIM_VIEWPORT_PROTOCOL_VERSION,
    sessionId,
    requestId: randomId(),
    messageId: randomId(),
    nonce,
    sentAt: new Date().toISOString(),
    source,
    stateRevision,
    type,
    payload,
  });
}

export function validateProtocolEnvelope(candidate, options = {}) {
  if (!isPlainObject(candidate)) return fail("MALFORMED_MESSAGE", "Envelope must be a plain object.");
  if (estimateProtocolMessageBytes(candidate) > (options.maxMessageBytes ?? BIM_VIEWPORT_MAX_MESSAGE_BYTES)) {
    return fail("MESSAGE_TOO_LARGE", "Protocol message exceeds the byte limit.");
  }
  if (Object.keys(candidate).some((key) => !ALLOWED_KEYS.has(key))) {
    return fail("MALFORMED_MESSAGE", "Protocol envelope contains an unknown field.");
  }
  if (candidate.protocol !== BIM_VIEWPORT_PROTOCOL) return fail("PROTOCOL_MISMATCH", "Protocol identifier is not supported.");
  const compatibility = assessProtocolCompatibility(candidate.protocolVersion);
  if (!compatibility.ok) return compatibility;
  if (![candidate.sessionId, candidate.requestId, candidate.messageId, candidate.nonce].every(isOpaqueIdentifier)) {
    return fail("MALFORMED_MESSAGE", "Protocol identifiers are invalid.");
  }
  if (!MESSAGE_TYPES.has(candidate.type) || !["host", "viewer"].includes(candidate.source)) {
    return fail("UNSUPPORTED_MESSAGE_TYPE", "Message type or source is not supported.");
  }
  const sourceMatches = BIDIRECTIONAL_TYPES.has(candidate.type)
    || (candidate.source === "host" && HOST_TYPES.has(candidate.type))
    || (candidate.source === "viewer" && VIEWER_TYPES.has(candidate.type));
  if (!sourceMatches) return fail("INVALID_SOURCE", "Message type is not allowed from this source.");
  if (!Number.isSafeInteger(candidate.stateRevision) || candidate.stateRevision < 0 || !isPlainObject(candidate.payload)) {
    return fail("MALFORMED_MESSAGE", "State revision or payload is invalid.");
  }
  if (IDENTIFIER_LIST_MESSAGE_TYPES.has(candidate.type)) {
    const identifiers = validateIdentifierList(candidate.payload.identifiers);
    if (!identifiers.ok) return identifiers;
  }
  const sentAtMs = Date.parse(candidate.sentAt);
  const now = options.now ?? Date.now();
  if (!Number.isFinite(sentAtMs) || Math.abs(now - sentAtMs) > (options.maxClockSkewMs ?? BIM_VIEWPORT_MAX_CLOCK_SKEW_MS)) {
    return fail("STALE_MESSAGE", "Message timestamp is outside the acceptance window.");
  }
  return Object.freeze({ ok: true, value: candidate, negotiatedVersion: compatibility.negotiatedVersion });
}

export function assessProtocolMessage(event, context) {
  if (!event || event.origin !== context.expectedOrigin) return fail("INVALID_ORIGIN", "Unexpected origin.");
  if (event.source !== context.expectedWindow) return fail("INVALID_WINDOW_SOURCE", "Unexpected window.");
  const envelope = validateProtocolEnvelope(event.data, context);
  if (!envelope.ok) return envelope;
  if (event.data.sessionId !== context.sessionId) return fail("INVALID_SESSION", "Unexpected session.");
  if (event.data.nonce !== context.nonce) return fail("INVALID_NONCE", "Unexpected nonce.");
  if (!context.seenMessageIds || typeof context.seenMessageIds.has !== "function") {
    return fail("MISSING_REPLAY_STATE", "Replay protection state is required.");
  }
  if (context.seenMessageIds.has(event.data.messageId)) return fail("REPLAYED_MESSAGE", "Message was already accepted.");
  if (event.data.stateRevision < context.stateRevision) return fail("STALE_MESSAGE", "Stale state revision.");
  const transition = resolveProtocolTransition(context.state, event.data.source, event.data.type);
  if (!transition.ok) return transition;
  return Object.freeze({ ok: true, value: event.data, nextState: transition.nextState });
}
