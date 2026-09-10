// SPDX-License-Identifier: AGPL-3.0-only
import {
  BIM_VIEWPORT_MAX_MESSAGE_BYTES,
  BIM_VIEWPORT_PROTOCOL_VERSION,
  assessProtocolMessage,
  createProtocolEnvelope,
  createProtocolRateLimiter,
  resolveProtocolTransition,
  validateIdentifierList,
} from "@ingenia/generic-bim-viewport-protocol";

const CAPABILITIES = Object.freeze([
  "lifecycle", "camera", "selection", "visibility", "appearance", "spatial",
  "snapshot", "measurement", "labels", "properties", "tree", "session", "reliability",
]);
const READY_RETRY_INTERVAL_MS = 400;
const MAX_READY_RETRIES = 24;
const MAX_REPLAY_ENTRIES = 4096;

const COMMAND_CAPABILITY = Object.freeze({
  "model.": "lifecycle",
  "camera.": "camera",
  "selection.": "selection",
  "measurement.": "measurement",
  "labels.": "labels",
  "properties.": "properties",
  "tree.": "tree",
  "session.": "session",
  "visibility.": "visibility",
  "appearance.": "appearance",
  "spatial.": "spatial",
  "snapshot.": "snapshot",
  "context.": "reliability",
});

function capabilityForCommand(type) {
  const prefix = Object.keys(COMMAND_CAPABILITY).find((candidate) => type.startsWith(candidate));
  return prefix ? COMMAND_CAPABILITY[prefix] : null;
}

function parseConfiguredOrigins(raw) {
  return new Set(String(raw || "").split(",").map((value) => value.trim()).filter(Boolean));
}

function requireIdentifierList(payload) {
  const validation = validateIdentifierList(payload.identifiers);
  if (validation.ok) return payload.identifiers;
  const error = new Error(validation.error.message);
  error.protocolCode = validation.error.code;
  throw error;
}

export function readBootstrapConfiguration(locationLike, configuredParentOrigins) {
  const params = new URLSearchParams(locationLike.search || "");
  const parentOrigin = params.get("parentOrigin") || "";
  const sessionId = params.get("sessionId") || "";
  const nonce = params.get("nonce") || "";
  const locale = (params.get("locale") || params.get("lang")) === "en" ? "en" : "vi";
  const allowedOrigins = parseConfiguredOrigins(configuredParentOrigins);
  if (!allowedOrigins.has(parentOrigin)) throw new Error("Parent origin is not allowlisted.");
  if (!/^[A-Za-z0-9._~-]{16,128}$/.test(sessionId) || !/^[A-Za-z0-9._~-]{16,128}$/.test(nonce)) {
    throw new Error("Session bootstrap identifiers are invalid.");
  }
  return Object.freeze({ parentOrigin, sessionId, nonce, locale });
}

export function classifyCommandFailure(type, error) {
  const modelCommand = ["model.open", "model.add", "model.replace"].includes(type);
  const snapshotCommand = type === "snapshot.capture";
  const sessionCommand = type.startsWith("session.");
  const explicitCode = /^[A-Z][A-Z0-9_]{2,63}$/.test(String(error?.protocolCode || ""))
    ? String(error.protocolCode)
    : "";
  const explicitAction = /^[a-z][a-z0-9_]{2,63}$/.test(String(error?.recoveryAction || ""))
    ? String(error.recoveryAction)
    : "";
  const recoverable = typeof error?.recoverable === "boolean" ? error.recoverable : true;

  return Object.freeze({
    type: modelCommand ? "model.failed" : "request.error",
    code: explicitCode || (modelCommand
      ? "MODEL_LOAD_FAILED"
      : (snapshotCommand
        ? "SNAPSHOT_CAPTURE_FAILED"
        : (sessionCommand ? "SESSION_STATE_INVALID" : "COMMAND_FAILED"))),
    message: sessionCommand
      ? "Viewer session state could not be restored."
      : String(error?.message || error).slice(0, 512),
    recoverable,
    recoveryAction: explicitAction || (recoverable ? "retry_request" : "contact_support"),
  });
}

export function createViewerBridge({ parentWindow, parentOrigin, sessionId, nonce, handlers, viewerBuild, onInitialized }) {
  let state = "created";
  let stateRevision = 0;
  const seenMessageIds = new Set();
  const rateLimiter = createProtocolRateLimiter();
  const enabledCapabilities = new Set();
  let disposed = false;
  let readyRetryCount = 0;
  let readyRetryTimer = null;

  function post(type, payload = {}) {
    if (disposed) return;
    const envelope = createProtocolEnvelope({
      sessionId,
      nonce,
      stateRevision,
      source: "viewer",
      type,
      payload,
    });
    parentWindow.postMessage(envelope, parentOrigin);
    const transition = resolveProtocolTransition(state, "viewer", type);
    if (transition.ok && transition.nextState !== state) {
      state = transition.nextState;
      stateRevision += 1;
    }
  }

  function clearReadyRetry() {
    if (readyRetryTimer !== null && typeof window.clearTimeout === "function") {
      window.clearTimeout(readyRetryTimer);
    }
    readyRetryTimer = null;
  }

  function postViewerReady() {
    post("viewer.ready", {
      supportedProtocolVersions: [BIM_VIEWPORT_PROTOCOL_VERSION],
      supportedCapabilities: CAPABILITIES,
      viewerBuild,
    });
  }

  function queueReadyRetry() {
    if (
      disposed
      || state !== "viewer_ready"
      || readyRetryCount >= MAX_READY_RETRIES
      || typeof window.setTimeout !== "function"
    ) return;
    readyRetryTimer = window.setTimeout(() => {
      readyRetryTimer = null;
      if (disposed || state !== "viewer_ready") return;
      readyRetryCount += 1;
      postViewerReady();
      queueReadyRetry();
    }, READY_RETRY_INTERVAL_MS);
  }

  async function dispatch(message) {
    const payload = message.payload || {};
    if (message.type !== "host.initialize") {
      const requiredCapability = capabilityForCommand(message.type);
      if (requiredCapability && !enabledCapabilities.has(requiredCapability)) {
        throw new Error("Command capability was not negotiated for this viewer session.");
      }
    }
    switch (message.type) {
      case "host.initialize": {
        enabledCapabilities.clear();
        CAPABILITIES
          .filter((item) => payload.requestedCapabilities?.includes(item))
          .forEach((item) => enabledCapabilities.add(item));
        post("viewer.initialized", {
          acceptedProtocolVersion: BIM_VIEWPORT_PROTOCOL_VERSION,
          enabledCapabilities: Array.from(enabledCapabilities),
        });
        onInitialized?.();
        return;
      }
      case "model.open": return handlers.model.open(payload.model);
      case "model.add": return handlers.model.add(payload.model);
      case "model.replace": return handlers.model.replace(payload.model);
      case "model.remove": return handlers.model.remove(payload.modelId);
      case "camera.fit": return handlers.camera.fit(requireIdentifierList(payload), payload.useCurrentSelection === true);
      case "camera.set": return handlers.camera.set(payload);
      case "camera.view": return handlers.camera.view(payload.view);
      case "camera.navigation": return handlers.camera.navigation(payload);
      case "camera.day-night": return handlers.appearance.dayNight(payload.mode);
      case "selection.select": return handlers.selection.select(requireIdentifierList(payload));
      case "selection.clear": return handlers.selection.clear();
      case "selection.visible": return handlers.selection.visible(requireIdentifierList(payload));
      case "selection.match": return handlers.selection.match(requireIdentifierList(payload), payload.scope);
      case "selection.mode": return handlers.selection.mode(payload.mode);
      case "measurement.mode": return handlers.measurement.mode(payload.enabled);
      case "measurement.clear": return handlers.measurement.clear();
      case "labels.mode": return handlers.labels.mode(payload.enabled, payload.identifiers);
      case "properties.mode": return handlers.properties.mode(payload.enabled ?? payload.open);
      case "tree.mode": return handlers.tree.mode(payload.open);
      case "session.export": return handlers.session.export();
      case "session.import": return handlers.session.import(payload.stateRef);
      case "visibility.show": return handlers.visibility.show(requireIdentifierList(payload));
      case "visibility.hide": return handlers.visibility.hide(requireIdentifierList(payload), payload.useCurrentSelection === true);
      case "visibility.isolate": return handlers.visibility.isolate(requireIdentifierList(payload), payload.useCurrentSelection === true);
      case "visibility.reset": return handlers.visibility.reset();
      case "appearance.apply":
        requireIdentifierList(payload);
        return handlers.appearance.apply(payload);
      case "spatial.section.set": return handlers.spatial.setSection(payload);
      case "spatial.section.clear": return handlers.spatial.clearSection(payload);
      case "spatial.section.flip": return handlers.spatial.flipSection(payload);
      case "spatial.space-clip.set": return handlers.spatial.setSpaceClip();
      case "spatial.space-clip.clear": return handlers.spatial.clearSpaceClip();
      case "spatial.levels.request": return handlers.spatial.requestLevelOptions();
      case "spatial.level-clip.set": return handlers.spatial.setLevelClip(payload);
      case "spatial.level-clip.clear": return handlers.spatial.clearLevelClip();
      case "snapshot.capture": return handlers.snapshot.capture(payload);
      case "context.restore-requested": return handlers.reliability.restoreContext();
      default:
        throw new Error("Command is allowlisted but not implemented by this minimal viewer.");
    }
  }

  async function onMessage(event) {
    if (!rateLimiter.attempt().ok) return;
    const accepted = assessProtocolMessage(event, {
      expectedOrigin: parentOrigin,
      expectedWindow: parentWindow,
      sessionId,
      nonce,
      stateRevision,
      state,
      seenMessageIds,
      maxMessageBytes: BIM_VIEWPORT_MAX_MESSAGE_BYTES,
    });
    if (!accepted.ok) {
      const trustedPeer = event?.origin === parentOrigin
        && event?.source === parentWindow
        && event?.data?.sessionId === sessionId
        && event?.data?.nonce === nonce;
      if (trustedPeer && accepted.error.code === "INVALID_IDENTIFIER_LIST") {
        post("request.error", {
          requestId: event.data.requestId,
          code: accepted.error.code,
          message: accepted.error.message,
          recoverable: true,
          recoveryAction: accepted.error.recoveryAction,
        });
      }
      return;
    }
    seenMessageIds.add(accepted.value.messageId);
    if (seenMessageIds.size > MAX_REPLAY_ENTRIES) {
      seenMessageIds.delete(seenMessageIds.values().next().value);
    }
    const stateChanged = accepted.nextState !== state;
    state = accepted.nextState;
    stateRevision = Math.max(stateRevision, accepted.value.stateRevision);
    if (stateChanged) stateRevision += 1;
    if (accepted.value.type === "host.initialize") clearReadyRetry();
    try {
      const result = await dispatch(accepted.value);
      if (accepted.value.type === "snapshot.capture") {
        post("snapshot.result", { requestId: accepted.value.requestId, ...(result || {}) });
      } else if (["session.export", "session.import"].includes(accepted.value.type)) {
        post("session.state", {
          requestId: accepted.value.requestId,
          operation: accepted.value.type === "session.import" ? "import" : "export",
          restored: accepted.value.type === "session.import",
          ...(result || {}),
        });
      } else if (["model.open", "model.add", "model.replace"].includes(accepted.value.type) && result) {
        post("model.ready", { requestId: accepted.value.requestId, ...result });
      } else if (!accepted.value.type.startsWith("host.") && !accepted.value.type.startsWith("context.")) {
        post("request.ack", { requestId: accepted.value.requestId });
      }
    } catch (error) {
      const failure = classifyCommandFailure(accepted.value.type, error);
      post(failure.type, {
        requestId: accepted.value.requestId,
        code: failure.code,
        message: failure.message,
        recoverable: failure.recoverable,
        recoveryAction: failure.recoveryAction,
      });
    }
  }

  window.addEventListener("message", onMessage);
  postViewerReady();
  queueReadyRetry();

  return Object.freeze({
    post,
    destroy() {
      disposed = true;
      clearReadyRetry();
      window.removeEventListener("message", onMessage);
      seenMessageIds.clear();
      rateLimiter.reset();
      state = "closed";
    },
  });
}
