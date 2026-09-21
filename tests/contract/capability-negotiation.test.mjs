import test from "node:test";
import assert from "node:assert/strict";
import { createProtocolEnvelope } from "../../packages/protocol/src/index.js";
import { createViewerBridge } from "../../packages/viewer/src/protocol-bridge/bridge.js";

const requiredCapabilities = [
  "lifecycle", "camera", "selection", "visibility", "appearance", "spatial",
  "snapshot", "measurement", "labels", "properties", "tree", "reliability",
];

async function negotiate(requestedCapabilities) {
  const listeners = new Map();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const sent = [];
  const parentWindow = { postMessage(message, origin) { sent.push({ message, origin }); } };
  const parentOrigin = "https://host.example";
  const sessionId = "session.1234567890";
  const nonce = "nonce.123456789012";
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener(type) { listeners.delete(type); },
      setTimeout() { return 1; },
      clearTimeout() {},
    },
  });
  let bridge;
  try {
    bridge = createViewerBridge({
      parentWindow, parentOrigin, sessionId, nonce,
      viewerBuild: "build.1234567890", handlers: {},
    });
    assert.equal(sent[0].message.type, "viewer.ready");
    await listeners.get("message")({
      origin: parentOrigin,
      source: parentWindow,
      data: createProtocolEnvelope({
        sessionId, nonce, source: "host", stateRevision: 1,
        type: "host.initialize", payload: { requestedCapabilities },
      }),
    });
    assert.equal(sent.at(-1).message.type, "viewer.initialized");
    assert.equal(sent.at(-1).origin, parentOrigin);
    return {
      supported: sent[0].message.payload.supportedCapabilities,
      enabled: sent.at(-1).message.payload.enabledCapabilities,
    };
  } finally {
    bridge?.destroy();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete globalThis.window;
  }
}

test("initialization negotiates every required neutral viewport capability", async () => {
  const { supported, enabled } = await negotiate(requiredCapabilities);
  for (const capability of requiredCapabilities) {
    assert.ok(supported.includes(capability), `not advertised: ${capability}`);
    assert.ok(enabled.includes(capability), `not negotiated: ${capability}`);
  }
  assert.equal(enabled.length, requiredCapabilities.length);
  assert.equal(enabled.includes("session"), false);
});

test("session restore is negotiated only when explicitly requested", async () => {
  const { enabled } = await negotiate([...requiredCapabilities, "session"]);
  assert.deepEqual(new Set(enabled), new Set([...requiredCapabilities, "session"]));
});

test("initialization does not enable unrequested or unsupported capabilities", async () => {
  const { enabled } = await negotiate(["lifecycle", "unsupported-feature"]);
  assert.deepEqual(enabled, ["lifecycle"]);
});
