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
  "selection.select", "selection.clear", "selection.visible", "selection.match", "selection.marquee", "selection.mode", "selection.changed", "selection.context-menu",
  "object.picked", "object.hovered",
  "visibility.show", "visibility.hide", "visibility.isolate", "visibility.reset",
  "visibility.applied", "filter.apply", "filter.cancel", "filter.progress",
  "filter.applied", "appearance.apply", "appearance.applied",
  "spatial.section.set", "spatial.section.clear", "spatial.section.flip", "spatial.space-clip.set", "spatial.space-clip.clear", "spatial.levels.request", "spatial.levels.changed",
  "spatial.level-clip.set", "spatial.level-clip.clear", "spatial.level-clip.changed", "spatial.storeys.set", "spatial.grid.set", "spatial.site.set", "spatial.changed", "spatial.space-clip.changed", "metadata.request", "metadata.result",
  "snapshot.capture", "snapshot.result", "measurement.mode", "measurement.clear", "measurement.changed", "labels.mode", "properties.mode", "properties.changed", "tree.mode", "tree.changed", "session.export", "session.import",
  "session.state", "context.lost", "context.restore-requested", "context.restored",
  "context.restore-failed",
]);

const MESSAGE_TYPES = new Set(BIM_VIEWPORT_MESSAGE_TYPES);
const HOST_TYPES = new Set([
  "host.initialize", "request.cancel", "model.open", "model.add", "model.remove",
  "model.replace", "camera.set", "camera.get", "camera.fit", "camera.view",
  "camera.navigation", "camera.day-night", "selection.select", "selection.clear",
  "selection.visible", "selection.match", "selection.marquee", "selection.mode", "visibility.show", "visibility.hide", "visibility.isolate",
  "visibility.reset", "filter.apply", "filter.cancel", "appearance.apply",
  "spatial.section.set", "spatial.section.clear", "spatial.section.flip", "spatial.space-clip.set", "spatial.space-clip.clear", "spatial.levels.request", "spatial.level-clip.set", "spatial.level-clip.clear", "spatial.storeys.set",
  "spatial.grid.set", "spatial.site.set", "metadata.request", "snapshot.capture", "measurement.mode", "measurement.clear", "labels.mode", "properties.mode", "tree.mode", "session.export",
  "session.import", "context.restore-requested",
]);
const VIEWER_TYPES = new Set([
  "viewer.ready", "viewer.initialized", "model.progress", "model.ready",
  "model.failed", "model.revision", "camera.changed", "navigation.changed",
  "selection.changed", "selection.context-menu", "object.picked", "object.hovered", "measurement.changed", "visibility.applied",
  "filter.progress", "filter.applied", "appearance.applied", "spatial.changed", "spatial.space-clip.changed", "spatial.levels.changed", "spatial.level-clip.changed",
  "metadata.result", "snapshot.result", "session.state", "properties.changed", "tree.changed", "context.lost",
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
  "session.", "measurement.", "labels.", "properties.", "tree.",
];
const IDENTIFIER_LIST_MESSAGE_TYPES = new Set([
  "camera.fit", "selection.select", "selection.visible", "selection.match", "selection.changed", "selection.context-menu", "object.picked",
  "object.hovered", "visibility.show", "visibility.hide", "visibility.isolate",
  "appearance.apply",
]);
const MODEL_ATTRIBUTED_MESSAGE_TYPES = new Set([
  "selection.changed", "selection.context-menu", "object.picked",
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

function isViewStateReference(value) {
  return typeof value === "string"
    && /^viewstate\.session\.[A-Za-z0-9._~-]{16,128}$/.test(value);
}

function validateRequestCorrelationPayload(type, payload) {
  if (type !== "request.ack" && type !== "request.error") return Object.freeze({ ok: true });
  const allowedKeys = type === "request.ack"
    ? new Set(["requestId"])
    : new Set(["requestId", "code", "message", "recoverable", "recoveryAction"]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key)) || !isOpaqueIdentifier(payload.requestId)) {
    return fail("MALFORMED_MESSAGE", "Request responses require one valid correlation identifier.");
  }
  if (type === "request.ack" && Object.keys(payload).length !== 1) {
    return fail("MALFORMED_MESSAGE", "Request acknowledgements may only contain the correlation identifier.");
  }
  if (type === "request.error") {
    const boundedStrings = [
      ["code", 128],
      ["message", 512],
      ["recoveryAction", 128],
    ];
    if (boundedStrings.some(([key, maxLength]) => payload[key] !== undefined
      && (typeof payload[key] !== "string" || payload[key].length > maxLength))
      || (payload.recoverable !== undefined && typeof payload.recoverable !== "boolean")) {
      return fail("MALFORMED_MESSAGE", "Request error details must use bounded protocol values.");
    }
  }
  return Object.freeze({ ok: true });
}

function validateContextMenuAnchor(anchor) {
  if (!isPlainObject(anchor) || Object.keys(anchor).some((key) => key !== "x" && key !== "y")) {
    return fail("MALFORMED_MESSAGE", "Context-menu anchor must contain only normalized x and y coordinates.");
  }
  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y) || anchor.x < 0 || anchor.x > 1 || anchor.y < 0 || anchor.y > 1) {
    return fail("MALFORMED_MESSAGE", "Context-menu anchor must be normalized within the viewport.");
  }
  return Object.freeze({ ok: true });
}

function validateSelectionMatchScope(scope) {
  if (!["exact", "type", "system", "material", "tag", "storey"].includes(scope)) {
    return fail("MALFORMED_MESSAGE", "Selection match scope is not allowlisted.");
  }
  return Object.freeze({ ok: true });
}

function validateSelectionMode(mode) {
  if (!["single", "multi"].includes(mode)) {
    return fail("MALFORMED_MESSAGE", "Selection mode is not allowlisted.");
  }
  return Object.freeze({ ok: true });
}

function validateMeasurementMode(enabled) {
  if (typeof enabled !== "boolean") {
    return fail("MALFORMED_MESSAGE", "Measurement mode must be a boolean.");
  }
  return Object.freeze({ ok: true });
}

function validateMeasurementChanged(payload) {
  if (Object.keys(payload).some((key) => key !== "status" && key !== "distance")) {
    return fail("MALFORMED_MESSAGE", "Measurement result contains unknown fields.");
  }
  if (payload.status !== "complete" || !Number.isFinite(payload.distance) || payload.distance < 0 || payload.distance > 1e9) {
    return fail("MALFORMED_MESSAGE", "Measurement result is not bounded.");
  }
  return Object.freeze({ ok: true });
}

function validateLabelsMode(payload) {
  if (!isPlainObject(payload) || Object.keys(payload).some((key) => key !== "enabled" && key !== "identifiers")) {
    return fail("MALFORMED_MESSAGE", "Object label mode contains unknown fields.");
  }
  if (typeof payload.enabled !== "boolean") return fail("MALFORMED_MESSAGE", "Object label mode must be a boolean.");
  const identifiers = validateIdentifierList(payload.identifiers);
  if (!identifiers.ok) return identifiers;
  if (identifiers.count > 80) return fail("INVALID_IDENTIFIER_LIST", "Object label mode exceeds the visible label limit.");
  return Object.freeze({ ok: true });
}

function validateTreeMode(payload) {
  if (!isPlainObject(payload) || Object.keys(payload).some((key) => key !== "open")) {
    return fail("MALFORMED_MESSAGE", "Model tree mode contains unknown fields.");
  }
  if (typeof payload.open !== "boolean") return fail("MALFORMED_MESSAGE", "Model tree mode must be a boolean.");
  return Object.freeze({ ok: true });
}

function validateCameraNavigation(payload) {
  if (!isPlainObject(payload) || Object.keys(payload).some((key) => key !== "mode" && key !== "orbitPivotEnabled")) {
    return fail("MALFORMED_MESSAGE", "Camera navigation contains unknown fields.");
  }
  if (!["orbit", "walk", "fly"].includes(payload.mode)
      || (payload.orbitPivotEnabled !== undefined && typeof payload.orbitPivotEnabled !== "boolean")) {
    return fail("MALFORMED_MESSAGE", "Camera navigation mode is invalid.");
  }
  return Object.freeze({ ok: true });
}

function validatePropertiesMode(payload) {
  if (!isPlainObject(payload) || Object.keys(payload).some((key) => key !== "enabled" && key !== "open")) {
    return fail("MALFORMED_MESSAGE", "Object properties mode contains unknown fields.");
  }
  const value = payload.enabled ?? payload.open;
  if (typeof value !== "boolean") return fail("MALFORMED_MESSAGE", "Object properties mode must be a boolean.");
  return Object.freeze({ ok: true });
}

function validateSpaceClipPayload(type, payload) {
  if (type === "spatial.space-clip.set") {
    return Object.keys(payload).length === 1 && payload.useCurrentSelection === true
      ? Object.freeze({ ok: true })
      : fail("MALFORMED_MESSAGE", "Space clip requires the current Viewer selection.");
  }
  if (type === "spatial.space-clip.clear") {
    return Object.keys(payload).length === 0
      ? Object.freeze({ ok: true })
      : fail("MALFORMED_MESSAGE", "Space clip clear payload must be empty.");
  }
  const allowedKeys = new Set([
    "status", "reason", "displayName", "strategy", "retainedObjectCount", "scannedObjectCount", "totalObjectCount",
  ]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    return fail("MALFORMED_MESSAGE", "Space clip state contains unknown fields.");
  }
  if (payload.status === "active") {
    if (
      payload.reason !== undefined
      || payload.strategy !== "space-footprint-membership"
      || !Number.isSafeInteger(payload.retainedObjectCount)
      || payload.retainedObjectCount < 0
      || payload.retainedObjectCount > 500000
      || payload.scannedObjectCount !== undefined
      || payload.totalObjectCount !== undefined
      || (payload.displayName !== undefined && (
        typeof payload.displayName !== "string" || payload.displayName.length === 0 || payload.displayName.length > 200
      ))
    ) return fail("MALFORMED_MESSAGE", "Active space clip state is invalid.");
    return Object.freeze({ ok: true });
  }
  if (payload.status === "filtering") {
    if (
      payload.reason !== undefined
      || payload.displayName !== undefined
      || payload.retainedObjectCount !== undefined
      || payload.strategy !== "space-footprint-membership"
      || !Number.isSafeInteger(payload.scannedObjectCount)
      || !Number.isSafeInteger(payload.totalObjectCount)
      || payload.scannedObjectCount < 0
      || payload.totalObjectCount < 0
      || payload.scannedObjectCount > payload.totalObjectCount
      || payload.totalObjectCount > 500000
    ) return fail("MALFORMED_MESSAGE", "Space membership progress is invalid.");
    return Object.freeze({ ok: true });
  }
  if (payload.status === "cleared") {
    return Object.keys(payload).length === 1
      ? Object.freeze({ ok: true })
      : fail("MALFORMED_MESSAGE", "Cleared space clip state is invalid.");
  }
  if (payload.status === "rejected") {
    const reasons = new Set([
      "NO_SELECTION", "MULTIPLE_SELECTION", "NOT_IFC_SPACE", "OBJECT_NOT_RENDERED", "INVALID_AABB",
      "MODEL_CHANGED", "SPACE_GEOMETRY_UNAVAILABLE", "SPACE_FOOTPRINT_INVALID",
    ]);
    return Object.keys(payload).length === 2 && reasons.has(payload.reason)
      ? Object.freeze({ ok: true })
      : fail("MALFORMED_MESSAGE", "Rejected space clip state is invalid.");
  }
  return fail("MALFORMED_MESSAGE", "Space clip state is invalid.");
}

function validateLevelClipPayload(type, payload) {
  if (type === "spatial.levels.request" || type === "spatial.level-clip.clear") {
    return Object.keys(payload).length === 0
      ? Object.freeze({ ok: true })
      : fail("MALFORMED_MESSAGE", "Level clip command payload must be empty.");
  }
  if (type === "spatial.level-clip.set") {
    if (Object.keys(payload).some((key) => !["lowerLevelRef", "upperLevelRef", "lowerOffsetMm", "upperOffsetMm"].includes(key))
      || !isOpaqueIdentifier(payload.lowerLevelRef)
      || !isOpaqueIdentifier(payload.upperLevelRef)
      || payload.lowerLevelRef === payload.upperLevelRef
      || (payload.lowerOffsetMm !== undefined && (!Number.isSafeInteger(payload.lowerOffsetMm) || payload.lowerOffsetMm < -5000 || payload.lowerOffsetMm > 5000))
      || (payload.upperOffsetMm !== undefined && (!Number.isSafeInteger(payload.upperOffsetMm) || payload.upperOffsetMm < -5000 || payload.upperOffsetMm > 5000))) {
      return fail("MALFORMED_MESSAGE", "Level clip requires two distinct bounded level references.");
    }
    return Object.freeze({ ok: true });
  }
  if (type === "spatial.levels.changed") {
    if (Object.keys(payload).length !== 1 || !Array.isArray(payload.levels) || payload.levels.length > 120) {
      return fail("MALFORMED_MESSAGE", "Level options must be a bounded list.");
    }
    const references = new Set();
    for (const level of payload.levels) {
      if (!isPlainObject(level) || Object.keys(level).some((key) => key !== "reference" && key !== "label")
        || !isOpaqueIdentifier(level.reference)
        || typeof level.label !== "string" || level.label.length < 1 || level.label.length > 160
        || references.has(level.reference)) {
        return fail("MALFORMED_MESSAGE", "Level option is invalid.");
      }
      references.add(level.reference);
    }
    return Object.freeze({ ok: true });
  }
  const allowedKeys = new Set(["status", "reason", "lowerLabel", "upperLabel", "lowerOffsetMm", "upperOffsetMm"]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    return fail("MALFORMED_MESSAGE", "Level clip state contains unknown fields.");
  }
  if (payload.status === "active") {
    if ((Object.keys(payload).length !== 3 && Object.keys(payload).length !== 5)
      || typeof payload.lowerLabel !== "string" || payload.lowerLabel.length < 1 || payload.lowerLabel.length > 160
      || typeof payload.upperLabel !== "string" || payload.upperLabel.length < 1 || payload.upperLabel.length > 160
      || (payload.lowerOffsetMm !== undefined && (!Number.isSafeInteger(payload.lowerOffsetMm) || payload.lowerOffsetMm < -5000 || payload.lowerOffsetMm > 5000))
      || (payload.upperOffsetMm !== undefined && (!Number.isSafeInteger(payload.upperOffsetMm) || payload.upperOffsetMm < -5000 || payload.upperOffsetMm > 5000))) {
      return fail("MALFORMED_MESSAGE", "Active level clip state is invalid.");
    }
    return Object.freeze({ ok: true });
  }
  if (payload.status === "cleared") {
    return Object.keys(payload).length === 1
      ? Object.freeze({ ok: true })
      : fail("MALFORMED_MESSAGE", "Cleared level clip state is invalid.");
  }
  if (payload.status === "rejected" && Object.keys(payload).length === 2
    && ["UNKNOWN_LEVEL", "INVALID_LEVEL_RANGE", "LEVEL_ELEVATION_UNAVAILABLE"].includes(payload.reason)) {
    return Object.freeze({ ok: true });
  }
  return fail("MALFORMED_MESSAGE", "Level clip state is invalid.");
}

function validateSessionPayload(type, payload) {
  if (type === "session.export") {
    return Object.keys(payload).length === 0
      ? Object.freeze({ ok: true })
      : fail("MALFORMED_MESSAGE", "Session export payload must be empty.");
  }
  if (type === "session.import") {
    if (Object.keys(payload).some((key) => key !== "stateRef") || !isViewStateReference(payload.stateRef)) {
      return fail("MALFORMED_MESSAGE", "Session import requires one opaque state reference.");
    }
    return Object.freeze({ ok: true });
  }
  const allowedKeys = new Set([
    "requestId", "schemaVersion", "stateRef", "createdAt", "operation", "restored", "presentation",
  ]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    return fail("MALFORMED_MESSAGE", "Session state contains unknown fields.");
  }
  const presentation = payload.presentation;
  const presentationKeys = new Set(["navigationMode", "visualMode", "colorMode"]);
  if (
    !isOpaqueIdentifier(payload.requestId)
    || payload.schemaVersion !== 1
    || !isViewStateReference(payload.stateRef)
    || !Number.isSafeInteger(payload.createdAt)
    || payload.createdAt <= 0
    || !["export", "import"].includes(payload.operation)
    || typeof payload.restored !== "boolean"
    || !isPlainObject(presentation)
    || Object.keys(presentation).some((key) => !presentationKeys.has(key))
    || !["orbit", "walk", "fly"].includes(presentation.navigationMode)
    || !["day", "night"].includes(presentation.visualMode)
    || !["source", "ifc", "discipline"].includes(presentation.colorMode)
  ) {
    return fail("MALFORMED_MESSAGE", "Session state reference is invalid.");
  }
  return Object.freeze({ ok: true });
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
  if (MODEL_ATTRIBUTED_MESSAGE_TYPES.has(candidate.type)) {
    const requiresModelAttribution = candidate.type !== "selection.changed"
      || candidate.payload.identifiers.length > 0;
    if ((requiresModelAttribution || candidate.payload.modelVersionId !== undefined)
        && !isOpaqueIdentifier(candidate.payload.modelVersionId)) {
      return fail("MALFORMED_MESSAGE", "Model attribution must be a non-empty opaque bounded identifier.");
    }
  }
  const correlation = validateRequestCorrelationPayload(candidate.type, candidate.payload);
  if (!correlation.ok) return correlation;
  if (candidate.type === "selection.context-menu") {
    const anchor = validateContextMenuAnchor(candidate.payload.anchor);
    if (!anchor.ok) return anchor;
  }
  if (candidate.type === "selection.match") {
    const scope = validateSelectionMatchScope(candidate.payload.scope);
    if (!scope.ok) return scope;
  }
  if (candidate.type === "selection.mode") {
    const mode = validateSelectionMode(candidate.payload.mode);
    if (!mode.ok) return mode;
  }
  if (candidate.type === "measurement.mode") {
    const mode = validateMeasurementMode(candidate.payload.enabled);
    if (!mode.ok) return mode;
  }
  if (candidate.type === "measurement.changed") {
    const result = validateMeasurementChanged(candidate.payload);
    if (!result.ok) return result;
  }
  if (candidate.type === "labels.mode") {
    const mode = validateLabelsMode(candidate.payload);
    if (!mode.ok) return mode;
  }
  if (candidate.type === "tree.mode") {
    const mode = validateTreeMode(candidate.payload);
    if (!mode.ok) return mode;
  }
  if (candidate.type === "tree.changed") {
    const mode = validateTreeMode(candidate.payload);
    if (!mode.ok) return mode;
  }
  if (candidate.type === "camera.navigation") {
    const navigation = validateCameraNavigation(candidate.payload);
    if (!navigation.ok) return navigation;
  }
  if (candidate.type === "properties.mode" || candidate.type === "properties.changed") {
    const mode = validatePropertiesMode(candidate.payload);
    if (!mode.ok) return mode;
  }
  if (["spatial.space-clip.set", "spatial.space-clip.clear", "spatial.space-clip.changed"].includes(candidate.type)) {
    const spaceClip = validateSpaceClipPayload(candidate.type, candidate.payload);
    if (!spaceClip.ok) return spaceClip;
  }
  if (["spatial.levels.request", "spatial.levels.changed", "spatial.level-clip.set", "spatial.level-clip.clear", "spatial.level-clip.changed"].includes(candidate.type)) {
    const levelClip = validateLevelClipPayload(candidate.type, candidate.payload);
    if (!levelClip.ok) return levelClip;
  }
  if (["session.export", "session.import", "session.state"].includes(candidate.type)) {
    const session = validateSessionPayload(candidate.type, candidate.payload);
    if (!session.ok) return session;
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
