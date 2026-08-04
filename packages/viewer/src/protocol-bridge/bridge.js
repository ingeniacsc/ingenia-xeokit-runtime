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
  "reliability",
]);

const COMMAND_CAPABILITY = Object.freeze({
  "model.": "lifecycle",
  "camera.": "camera",
  "selection.": "selection",
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
  const allowedOrigins = parseConfiguredOrigins(configuredParentOrigins);
  if (!allowedOrigins.has(parentOrigin)) throw new Error("Parent origin is not allowlisted.");
  if (!/^[A-Za-z0-9._~-]{16,128}$/.test(sessionId) || !/^[A-Za-z0-9._~-]{16,128}$/.test(nonce)) {
    throw new Error("Session bootstrap identifiers are invalid.");
  }
  return Object.freeze({ parentOrigin, sessionId, nonce });
}

export function createViewerBridge({ parentWindow, parentOrigin, sessionId, nonce, handlers, viewerBuild }) {
  let state = "created";
  let stateRevision = 0;
  const seenMessageIds = new Set();
  const rateLimiter = createProtocolRateLimiter();
  const enabledCapabilities = new Set();
  let disposed = false;

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
        return;
      }
      case "model.open": return handlers.model.open(payload.model);
      case "model.add": return handlers.model.add(payload.model);
      case "model.replace": return handlers.model.replace(payload.model);
      case "model.remove": return handlers.model.remove(payload.modelId);
      case "camera.fit": return handlers.camera.fit(requireIdentifierList(payload));
      case "camera.set": return handlers.camera.set(payload);
      case "camera.view": return handlers.camera.view(payload.view);
      case "camera.navigation": return handlers.camera.navigation(payload.mode);
      case "camera.day-night": return handlers.appearance.dayNight(payload.mode);
      case "selection.select": return handlers.selection.select(requireIdentifierList(payload));
      case "selection.clear": return handlers.selection.clear();
      case "visibility.show": return handlers.visibility.show(requireIdentifierList(payload));
      case "visibility.hide": return handlers.visibility.hide(requireIdentifierList(payload));
      case "visibility.isolate": return handlers.visibility.isolate(requireIdentifierList(payload));
      case "visibility.reset": return handlers.visibility.reset();
      case "appearance.apply":
        requireIdentifierList(payload);
        return handlers.appearance.apply(payload);
      case "spatial.section.set": return handlers.spatial.setSection(payload);
      case "spatial.section.clear": return handlers.spatial.clearSection(payload);
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
          code: accepted.error.code,
          message: accepted.error.message,
          recoverable: true,
          recoveryAction: accepted.error.recoveryAction,
        });
      }
      return;
    }
    seenMessageIds.add(accepted.value.messageId);
    const stateChanged = accepted.nextState !== state;
    state = accepted.nextState;
    stateRevision = Math.max(stateRevision, accepted.value.stateRevision);
    if (stateChanged) stateRevision += 1;
    try {
      const result = await dispatch(accepted.value);
      if (["model.open", "model.add", "model.replace"].includes(accepted.value.type) && result) {
        post("model.ready", result);
      } else if (!accepted.value.type.startsWith("host.") && !accepted.value.type.startsWith("context.")) {
        post("request.ack", { requestId: accepted.value.requestId });
      }
    } catch (error) {
      const modelCommand = accepted.value.type.startsWith("model.");
      post(modelCommand ? "model.failed" : "request.error", {
        code: modelCommand ? "MODEL_LOAD_FAILED" : (error?.protocolCode || "COMMAND_FAILED"),
        message: String(error?.message || error).slice(0, 512),
        recoverable: true,
        recoveryAction: "retry_request",
      });
    }
  }

  window.addEventListener("message", onMessage);
  post("viewer.ready", {
    supportedProtocolVersions: [BIM_VIEWPORT_PROTOCOL_VERSION],
    supportedCapabilities: CAPABILITIES,
    viewerBuild,
  });

  return Object.freeze({
    post,
    destroy() {
      disposed = true;
      window.removeEventListener("message", onMessage);
      seenMessageIds.clear();
      rateLimiter.reset();
      state = "closed";
    },
  });
}
