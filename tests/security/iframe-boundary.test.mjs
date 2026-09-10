import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runInNewContext } from "node:vm";

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("nginx restricts iframe ancestors and sends no-referrer", async () => {
  const nginx = await readFile(path.join(runtimeRoot, "docker/nginx.conf"), "utf8");
  assert.match(nginx, /frame-ancestors \$\{XEOKIT_FRAME_ANCESTORS\}/);
  assert.match(nginx, /connect-src 'self' \$\{XEOKIT_CONNECT_SRC\}/);
  assert.match(nginx, /Referrer-Policy "no-referrer"/);
  assert.doesNotMatch(nginx, /Access-Control-Allow-Origin\s+\*/);
});

test("viewer image compiles an exact parent-origin allowlist", async () => {
  const dockerfile = await readFile(path.join(runtimeRoot, "docker/Dockerfile"), "utf8");
  assert.match(dockerfile, /ARG VITE_ALLOWED_PARENT_ORIGINS=https:\/\/ingenia\.vn/);
  assert.match(dockerfile, /ENV VITE_ALLOWED_PARENT_ORIGINS=\$VITE_ALLOWED_PARENT_ORIGINS/);
  assert.match(dockerfile, /XEOKIT_FRAME_ANCESTORS=https:\/\/ingenia\.vn/);
  assert.match(dockerfile, /XEOKIT_CONNECT_SRC=https:\/\/ingenia\.vn/);
  assert.match(dockerfile, /\/etc\/nginx\/templates\/default\.conf\.template/);
});

test("viewer bootstrap accepts only the supported presentation locales", async () => {
  const { readBootstrapConfiguration } = await import(
    "../../packages/viewer/src/protocol-bridge/bridge.js"
  );
  const base = "?parentOrigin=https%3A%2F%2Fingenia.vn&sessionId=session.1234567890&nonce=nonce.123456789012";
  assert.equal(readBootstrapConfiguration({ search: `${base}&locale=en` }, "https://ingenia.vn").locale, "en");
  assert.equal(readBootstrapConfiguration({ search: `${base}&lang=en` }, "https://ingenia.vn").locale, "en");
  assert.equal(readBootstrapConfiguration({ search: `${base}&locale=fr` }, "https://ingenia.vn").locale, "vi");
});

test("viewer reports graphics bootstrap failures without retrying artifact capabilities", async () => {
  const { classifyCommandFailure } = await import(
    "../../packages/viewer/src/protocol-bridge/bridge.js"
  );
  const error = new Error("Viewer graphics runtime is unavailable.");
  error.protocolCode = "VIEWER_RUNTIME_UNAVAILABLE";
  error.recoverable = false;
  error.recoveryAction = "check_browser_graphics";

  assert.deepEqual(classifyCommandFailure("model.open", error), {
    type: "model.failed",
    code: "VIEWER_RUNTIME_UNAVAILABLE",
    message: "Viewer graphics runtime is unavailable.",
    recoverable: false,
    recoveryAction: "check_browser_graphics",
  });
});

test("public candidate contains no business API or credential vocabulary", async () => {
  const files = [
    "packages/viewer/src/main.js",
    "packages/viewer/src/protocol-bridge/bridge.js",
    "packages/protocol/src/index.js",
  ];
  const prohibited = /authorization|bearer|cookie|django|celery|password|secret|cde|apping|schedule|permission|role/gi;
  for (const relativePath of files) {
    const source = await readFile(path.join(runtimeRoot, relativePath), "utf8");
    assert.equal(source.match(prohibited), null, `${relativePath} contains prohibited coupling`);
  }
});

test("viewer dependency versions are exact pins", async () => {
  const manifest = JSON.parse(await readFile(path.join(runtimeRoot, "packages/viewer/package.json"), "utf8"));
  assert.equal(manifest.dependencies["@xeokit/xeokit-sdk"], "2.6.107");
  assert.equal(manifest.devDependencies.vite, "8.1.5");
});

test("viewer supplies a CSP-safe spinner instead of xeokit's inline stylesheet", async () => {
  const runtime = await readFile(path.join(runtimeRoot, "packages/viewer/src/xeokit/runtime.js"), "utf8");
  const html = await readFile(path.join(runtimeRoot, "packages/viewer/index.html"), "utf8");
  const main = await readFile(path.join(runtimeRoot, "packages/viewer/src/main.js"), "utf8");
  const styles = await readFile(path.join(runtimeRoot, "packages/viewer/src/styles.css"), "utf8");
  assert.match(runtime, /spinnerElementId:\s*["']xeokit-spinner["']/);
  assert.match(runtime, /XKTDefaultDataSource\(\{\s*cacheBuster:\s*false\s*\}\)/);
  assert.match(html, /id=["']xeokit-spinner["'][^>]*\shidden(?:\s|>)/);
  assert.match(html, /id=["']viewport-status["'][^>]*\shidden(?:\s|>)/);
  assert.match(main, /const viewerIsEmbedded = window\.parent !== window/);
  assert.match(main, /status\.hidden = viewerIsEmbedded/);
  assert.match(styles, /#xeokit-spinner\s*\{\s*display:\s*none\s*!important;/);
  assert.doesNotMatch(runtime, /unsafe-inline/);
  assert.doesNotMatch(html, /<style(?:\s|>)/i);
});

test("embedded notifications stay hidden without suppressing standalone status", async () => {
  const main = await readFile(path.join(runtimeRoot, "packages/viewer/src/main.js"), "utf8");
  const body = main.slice(main.indexOf("function showStatus("), main.indexOf("function resolveCommandSelection("));
  assert.match(main, /container: viewerIsEmbedded \? null : document\.querySelector/);
  for (const viewerIsEmbedded of [true, false]) {
    const context = { viewerIsEmbedded, status: {hidden: true, dataset: {}},
      title: {}, detail: {}, progress: {} };
    runInNewContext(`${body}; showStatus('error', 'Xeokit Ready', 'diagnostic', 10);`, context);
    assert.equal(context.status.hidden, viewerIsEmbedded);
    assert.equal(context.title.textContent, viewerIsEmbedded ? undefined : "Xeokit Ready");
    assert.equal(context.detail.textContent, viewerIsEmbedded ? undefined : "diagnostic");
  }
});

test("model fetch omits credentials and forwards only bounded neutral X headers", async () => {
  const { createModelController } = await import("../../packages/viewer/src/xeokit/model.js");
  const originalFetch = globalThis.fetch;
  const requests = [];
  let loadedParams;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
    },
  });
  const loader = {
    load(params) {
      loadedParams = params;
      const listeners = {};
      queueMicrotask(() => listeners.loaded?.());
      return { on(type, callback) { listeners[type] = callback; }, destroy() {} };
    },
  };
  try {
    const controller = createModelController({ viewer: {}, loader });
    await controller.open({
      modelId: "model.123456789012",
      artifactUrl: "https://artifact.example/model.xkt",
      contentHash: "af5570f5a1810b7af78caf4bc70a660f0df51e42baf91d4de5b2328de0e83dfc",
      revision: 1,
      format: "xkt",
      requestHeaders: { "X-Artifact-Capability": "opaque_value_1234567890" },
    });
    assert.equal(requests[0].options.credentials, "omit");
    assert.equal(requests[0].options.referrerPolicy, "no-referrer");
    assert.deepEqual(requests[0].options.headers, {
      "X-Artifact-Capability": "opaque_value_1234567890",
    });
    assert.equal(loadedParams.xkt.byteLength, 8);
    await assert.rejects(() => controller.add({
      modelId: "model.223456789012",
      artifactUrl: "https://artifact.example/model.xkt",
      contentHash: "b".repeat(64),
      revision: 2,
      format: "xkt",
      requestHeaders: { "Not-X": "blocked" },
    }), /header is invalid/i);
  } finally {
    Object.defineProperty(globalThis, "fetch", { value: originalFetch, configurable: true });
  }
});

test("browser selection seam is compile-time gated to the local canary build", async () => {
  const main = await readFile(path.join(runtimeRoot, "packages/viewer/src/main.js"), "utf8");
  assert.match(main, /VITE_BROWSER_CANARY\s*===\s*["']true["']/);
  assert.match(main, /__bimCanaryPickFirstObject/);
  assert.match(main, /__bimCanaryOpenContextMenuFirstObjectForModel/);
  assert.match(main, /__bimCanaryBusinessAppearanceSnapshot/);
  assert.match(main, /firstObjectIdentifierForModel/);
  assert.match(main, /createPublicSelectionPayload\(\{ identifiers: \[identifier\], modelVersionId \}\)/);
});

test("xeokit object identifiers stay private behind bounded session tokens", async () => {
  const { createObjectIdentifierRegistry } = await import(
    "../../packages/viewer/src/xeokit/object-identifiers.js"
  );
  const registry = createObjectIdentifierRegistry();
  const internal = "public-ifc-open-house4#2O2Fr$t4XZ7f8NOew3FLOH";
  const token = registry.toToken(internal);
  assert.match(token, /^[A-Za-z0-9._~-]{16,128}$/);
  assert.equal(token.includes("#"), false);
  assert.deepEqual(registry.toObjectIds([token]), [internal]);
  assert.throws(
    () => registry.toObjectIds(["object.session.999999999999"]),
    /not registered/i,
  );
});

test("selection messages preserve model attribution across the iframe boundary", async () => {
  const main = await readFile(path.join(runtimeRoot, "packages/viewer/src/main.js"), "utf8");
  assert.match(main, /createPublicSelectionPayload/);
  assert.match(main, /return \{ identifiers: publicIdentifiers, modelVersionId \}/);
  assert.match(main, /selection\.context-menu[\s\S]*?\.\.\.publicPayload/);
  assert.match(main, /onSelectionChanged:[\s\S]*?publishSelectionChanged/);
});

test("fresh selection references replace an older reference for the same xeokit object", async () => {
  const { createObjectIdentifierRegistry } = await import(
    "../../packages/viewer/src/xeokit/object-identifiers.js"
  );
  const registry = createObjectIdentifierRegistry();
  const internal = "published-model#2O2Fr$t4XZ7f8NOew3FLOH";
  const firstReference = "selection.session.Abcdefghijklmnop";
  const refreshedReference = "selection.session.Qrstuvwxyz123456";

  registry.register(firstReference, internal);
  registry.register(refreshedReference, internal);

  assert.equal(registry.tokenForObjectId(internal), refreshedReference);
  assert.deepEqual(registry.toObjectIds([refreshedReference]), [internal]);
  assert.throws(() => registry.toObjectIds([firstReference]), /not registered/i);
});

test("protocol envelopes have no insecure identifier fallback", async () => {
  const protocol = await import("../../packages/protocol/src/index.js");
  const originalCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
  try {
    assert.throws(() => protocol.createProtocolEnvelope({
      sessionId: "session.1234567890",
      nonce: "nonce.123456789012",
      stateRevision: 0,
      source: "viewer",
      type: "viewer.ready",
    }), /Secure opaque identifiers/);
  } finally {
    Object.defineProperty(globalThis, "crypto", { value: originalCrypto, configurable: true });
  }
});

test("viewer handshake accepts consecutive active commands at one stable revision", async () => {
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
  const calls = [];
  let bridge;
  try {
    bridge = createViewerBridge({
      parentWindow,
      parentOrigin: "https://host.example",
      sessionId: "session.1234567890",
      nonce: "nonce.123456789012",
      viewerBuild: "build.1234567890",
      handlers: {
        model: {
          open: async () => { calls.push("model.open"); return { modelId: "model.123456789012" }; },
          remove: async () => { throw new Error("remove failed"); },
        },
        camera: { navigation: async () => { calls.push("camera.navigation"); } },
        session: {
          export: async () => {
            calls.push("session.export");
            return {
              schemaVersion: 1,
              stateRef: "viewstate.session.Abcdefghijklmnop",
              createdAt: 1787875200000,
              presentation: {
                navigationMode: "orbit",
                visualMode: "day",
                colorMode: "source",
              },
            };
          },
          import: async (stateRef) => {
            calls.push(`session.import:${stateRef}`);
            return {
              schemaVersion: 1,
              stateRef,
              createdAt: 1787875200000,
              presentation: {
                navigationMode: "orbit",
                visualMode: "day",
                colorMode: "source",
              },
            };
          },
        },
        reliability: { restoreContext: async () => { calls.push("context.restore-requested"); } },
      },
    });
    assert.equal(sent[0].message.type, "viewer.ready");
    assert.equal(sent[0].message.stateRevision, 0);

    const deliver = async (type, stateRevision, payload = {}) => {
      const envelope = protocol.createProtocolEnvelope({
        sessionId: "session.1234567890",
        nonce: "nonce.123456789012",
        stateRevision,
        source: "host",
        type,
        payload,
      });
      await listeners.get("message")({
        origin: "https://host.example",
        source: parentWindow,
        data: envelope,
      });
      return envelope;
    };
    await deliver("host.initialize", 1, {
      requestedCapabilities: ["lifecycle", "camera", "selection", "session", "reliability"],
    });
    assert.equal(sent.at(-1).message.type, "viewer.initialized");
    assert.equal(sent.at(-1).message.stateRevision, 2);
    const modelOpenRequest = await deliver("model.open", 3, { model: { modelId: "model.123456789012" } });
    assert.equal(sent.at(-1).message.type, "model.ready");
    assert.equal(sent.at(-1).message.payload.requestId, modelOpenRequest.requestId);
    const modelRemoveRequest = await deliver("model.remove", 3, { modelId: "model.123456789012" });
    assert.equal(sent.at(-1).message.type, "request.error");
    assert.equal(sent.at(-1).message.payload.requestId, modelRemoveRequest.requestId);
    await deliver("camera.navigation", 3, { mode: "orbit" });
    assert.deepEqual(calls, ["model.open", "camera.navigation"]);

    await deliver("session.export", 3, {});
    assert.equal(sent.at(-1).message.type, "session.state");
    assert.equal(sent.at(-1).message.payload.operation, "export");
    assert.equal(sent.at(-1).message.payload.restored, false);
    assert.equal(sent.at(-1).message.payload.stateRef, "viewstate.session.Abcdefghijklmnop");

    await deliver("session.import", 3, {
      stateRef: "viewstate.session.Abcdefghijklmnop",
    });
    assert.equal(sent.at(-1).message.type, "session.state");
    assert.equal(sent.at(-1).message.payload.operation, "import");
    assert.equal(sent.at(-1).message.payload.restored, true);
    assert.equal(calls.at(-1), "session.import:viewstate.session.Abcdefghijklmnop");

    await deliver("selection.select", 3, {
      identifiers: ["opaque_identifier_0001", "opaque_identifier_0001"],
    });
    assert.equal(sent.at(-1).message.type, "request.error");
    assert.equal(sent.at(-1).message.payload.code, "INVALID_IDENTIFIER_LIST");

    await deliver("snapshot.capture", 3, {});
    assert.equal(sent.at(-1).message.type, "request.error");
    assert.match(sent.at(-1).message.payload.message, /not negotiated/);

    bridge.post("context.lost", {});
    assert.equal(sent.at(-1).message.type, "context.lost");
    const sentBeforeRestore = sent.length;
    await deliver("context.restore-requested", 4, {});
    assert.equal(calls.at(-1), "context.restore-requested");
    assert.equal(sent.length, sentBeforeRestore, "restore completion must come from the WebGL restored event");
  } finally {
    bridge?.destroy();
    Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
  }
});

test("viewer retries the ready handshake until the host initializes", async () => {
  const protocol = await import("../../packages/protocol/src/index.js");
  const { createViewerBridge } = await import("../../packages/viewer/src/protocol-bridge/bridge.js");
  const listeners = new Map();
  const timers = [];
  const clearedTimers = [];
  const fakeWindow = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    setTimeout(callback) { timers.push(callback); return timers.length; },
    clearTimeout(timerId) { clearedTimers.push(timerId); },
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
      handlers: { model: {}, camera: {}, appearance: {}, spatial: {}, selection: {}, visibility: {}, reliability: {} },
    });
    assert.equal(sent.length, 1);
    timers.shift()();
    assert.equal(sent.length, 2);
    assert.equal(sent[1].message.type, "viewer.ready");
    assert.equal(sent[1].message.stateRevision, 1);

    await listeners.get("message")({
      origin: "https://host.example",
      source: parentWindow,
      data: protocol.createProtocolEnvelope({
        sessionId: "session.1234567890",
        nonce: "nonce.123456789012",
        stateRevision: 1,
        source: "host",
        type: "host.initialize",
        payload: { requestedCapabilities: ["lifecycle"] },
      }),
    });
    assert.equal(sent.at(-1).message.type, "viewer.initialized");
    assert.deepEqual(clearedTimers, [1]);
  } finally {
    bridge?.destroy();
    Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
  }
});
