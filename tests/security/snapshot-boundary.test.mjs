import assert from "node:assert/strict";
import test from "node:test";

test("snapshot controller downloads a bounded PNG without exposing its data URL", async () => {
  const { createSnapshotController } = await import("../../packages/viewer/src/xeokit/snapshot.js");
  const snapshotCalls = [];
  const links = [];
  const documentLike = {
    createElement() {
      const link = { click() { link.clicked = true; } };
      links.push(link);
      return link;
    },
    body: {
      appendChild(link) { link.appended = true; },
      removeChild(link) { link.removed = true; },
    },
  };
  const controller = createSnapshotController({
    getSnapshot(options) {
      snapshotCalls.push(options);
      return "data:image/png;base64,AA==";
    },
  }, documentLike);

  const result = controller.download({ width: 9000, height: 0 });
  assert.deepEqual(result, { format: "png", width: 4096, height: 1080, downloaded: true });
  assert.equal(snapshotCalls.length, 1);
  assert.equal(snapshotCalls[0].format, "png");
  assert.equal(snapshotCalls[0].includeGizmos, false);
  assert.equal(links[0].clicked, true);
  assert.equal(links[0].removed, true);
  assert.equal(Object.hasOwn(result, "dataUrl"), false);
});

test("negotiated snapshot command returns metadata only", async () => {
  const protocol = await import("../../packages/protocol/src/index.js");
  const { createViewerBridge } = await import("../../packages/viewer/src/protocol-bridge/bridge.js");
  const listeners = new Map();
  const fakeWindow = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
  };
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
  const sent = [];
  const parentWindow = { postMessage(message, origin) { sent.push({ message, origin }); } };
  let bridge;
  try {
    bridge = createViewerBridge({
      parentWindow,
      parentOrigin: "https://host.example",
      sessionId: "session.1234567890",
      nonce: "nonce.123456789012",
      viewerBuild: "build.1234567890",
      handlers: {
        snapshot: { capture: async () => ({ format: "png", width: 1920, height: 1080, downloaded: true }) },
      },
    });
    const deliver = async (type, stateRevision, payload = {}) => {
      await listeners.get("message")({
        origin: "https://host.example",
        source: parentWindow,
        data: protocol.createProtocolEnvelope({
          sessionId: "session.1234567890",
          nonce: "nonce.123456789012",
          stateRevision,
          source: "host",
          type,
          payload,
        }),
      });
    };
    await deliver("host.initialize", 1, { requestedCapabilities: ["snapshot"] });
    await deliver("snapshot.capture", 3, { format: "png", width: 1920, height: 1080 });
    const result = sent.at(-1).message;
    assert.equal(result.type, "snapshot.result");
    assert.equal(result.payload.format, "png");
    assert.equal(result.payload.downloaded, true);
    assert.equal(Object.hasOwn(result.payload, "dataUrl"), false);
  } finally {
    bridge?.destroy();
    Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
  }
});