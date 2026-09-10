import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createModelController } from "../../packages/viewer/src/xeokit/model.js";

async function waitForLoadedHandler(handlers) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (typeof handlers.loaded === "function") return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Model loader did not register a loaded handler.");
}

test("loaded models are revealed, fitted, and rendered before ready", async () => {
  const content = new Uint8Array([1, 2, 3, 4]).buffer;
  const contentHash = createHash("sha256").update(Buffer.from(content)).digest("hex");
  const handlers = {};
  const calls = [];
  const loaderCalls = [];
  const progressEvents = [];
  const model = {
    numEntities: 2,
    on: (name, handler) => { handlers[name] = handler; },
    destroy: () => calls.push("destroy"),
  };
  const viewer = {
    camera: { projection: "ortho" },
    cameraFlight: {
      stop: () => calls.push("stop"),
      jumpTo: (options) => calls.push(options),
    },
    resize: () => calls.push("resize"),
    scene: {
      objects: { first: { visible: false }, second: { visible: false } },
      getAABB: () => new Float64Array([0, 0, 0, 10, 20, 30]),
      render: () => calls.push("render"),
    },
  };
  const originalFetch = globalThis.fetch;
  const originalAnimationFrame = globalThis.requestAnimationFrame;
  const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4])];
  globalThis.fetch = async () => ({
    ok: true,
    body: {
      getReader: () => ({
        read: async () => (chunks.length ? { done: false, value: chunks.shift() } : { done: true }),
        releaseLock: () => {},
      }),
    },
    arrayBuffer: async () => content,
  });
  assert.ok(globalThis.crypto?.subtle, "Node test runtime must provide Web Crypto");
  globalThis.requestAnimationFrame = (callback) => callback();

  try {
    const controller = createModelController({
      viewer,
      loader: { load: (options) => { loaderCalls.push(options); return model; } },
      onProgress: (event) => progressEvents.push(event),
    });
    const opened = controller.open({
      modelId: "model-a",
      format: "xkt",
      artifactUrl: "https://viewer.invalid/content",
      selectionReferenceUrl: "https://viewer.invalid/selection-references",
      contentHash,
      byteLength: 4,
    });
    await waitForLoadedHandler(handlers);
    handlers.loaded();

    const result = await opened;
    assert.deepEqual(result, { modelId: "model-a", objectCount: 2 });
    assert.equal(viewer.camera.projection, "perspective");
    assert.equal(viewer.scene.objects.first.visible, true);
    assert.equal(viewer.scene.objects.second.visible, true);
    assert.deepEqual(calls.filter((call) => typeof call === "object"), [
      { aabb: [0, 0, 0, 10, 20, 30], fit: true, fitFOV: 36, projection: "perspective" },
    ]);
    assert.ok(calls.includes("resize"));
    assert.ok(calls.includes("render"));
    assert.deepEqual(new Uint8Array(loaderCalls[0].xkt), new Uint8Array(content));
    assert.equal("src" in loaderCalls[0], false);
    assert.ok(progressEvents.some((event) => event.phase === "fetching" && event.percent > 5));
    assert.ok(progressEvents.some((event) => event.phase === "verifying" && event.percent === 66));
    assert.ok(progressEvents.some((event) => event.phase === "rendering" && event.percent === 99));
    assert.equal(progressEvents.at(-1).percent, 100);
    assert.deepEqual(
      progressEvents.map((event) => event.percent),
      [...progressEvents.map((event) => event.percent)].sort((left, right) => left - right),
    );
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.requestAnimationFrame = originalAnimationFrame;
  }
});

test("capability geometry scope hides objects outside the server allowlist before ready", async () => {
  const content = new Uint8Array([71, 72, 73, 74]).buffer;
  const contentHash = createHash("sha256").update(Buffer.from(content)).digest("hex");
  const handlers = {};
  const modelId = "model-scope";
  const viewer = {
    camera: { projection: "perspective" },
    cameraFlight: { jumpTo: () => {} },
    resize: () => {},
    scene: {
      objects: {},
      getAABB: () => new Float64Array([0, 0, 0, 1, 1, 1]),
      render: () => {},
      setObjectsVisible(objectIds, visible) {
        objectIds.forEach((objectId) => {
          if (this.objects[objectId]) this.objects[objectId].visible = visible;
        });
      },
    },
  };
  const originalFetch = globalThis.fetch;
  const originalAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/geometry-scope")) {
      return {
        ok: true,
        headers: { get: () => null },
        text: async () => JSON.stringify({
          schemaVersion: "viewer_geometry_scope.v1",
          modelVersionId: modelId,
          geometryScope: { mode: "allowlist", allowedObjectIds: ["WALL-1"] },
        }),
      };
    }
    return { ok: true, arrayBuffer: async () => content };
  };
  globalThis.requestAnimationFrame = (callback) => callback();

  try {
    const controller = createModelController({
      viewer,
      loader: {
        load: () => {
          viewer.scene.objects[`${modelId}#WALL-1`] = { id: `${modelId}#WALL-1`, visible: true };
          viewer.scene.objects[`${modelId}#WALL-2`] = { id: `${modelId}#WALL-2`, visible: true };
          return {
            numEntities: 2,
            on: (name, handler) => { handlers[name] = handler; },
            destroy: () => {},
          };
        },
      },
    });
    const opened = controller.open({
      modelId,
      format: "xkt",
      artifactUrl: "https://viewer.invalid/content",
      geometryScopeUrl: "https://viewer.invalid/geometry-scope",
      requestHeaders: { "X-Artifact-Capability": "capability_token_12345678901234567890" },
      contentHash,
    });
    await waitForLoadedHandler(handlers);
    handlers.loaded();

    assert.deepEqual(await opened, { modelId, objectCount: 1 });
    assert.equal(viewer.scene.objects[`${modelId}#WALL-1`].visible, true);
    assert.equal(viewer.scene.objects[`${modelId}#WALL-2`].visible, false);
    assert.equal(controller.isObjectAllowed(`${modelId}#WALL-1`), true);
    assert.equal(controller.isObjectAllowed(`${modelId}#WALL-2`), false);
    assert.deepEqual(
      controller.filterAllowedObjectIds([`${modelId}#WALL-1`, `${modelId}#WALL-2`]),
      [`${modelId}#WALL-1`],
    );
    viewer.scene.objects[`${modelId}#WALL-2`].visible = true;
    assert.equal(controller.enforceGeometryScopes(), 1);
    assert.equal(viewer.scene.objects[`${modelId}#WALL-2`].visible, false);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.requestAnimationFrame = originalAnimationFrame;
  }
});

test("hot federation add preserves the current camera", async () => {
  const content = new Uint8Array([5, 6, 7, 8]).buffer;
  const contentHash = createHash("sha256").update(Buffer.from(content)).digest("hex");
  const handlers = {};
  const calls = [];
  const model = {
    numEntities: 1,
    on: (name, handler) => { handlers[name] = handler; },
    destroy: () => calls.push("destroy"),
  };
  const viewer = {
    camera: { projection: "perspective" },
    cameraFlight: { jumpTo: () => calls.push("fit") },
    resize: () => calls.push("resize"),
    scene: {
      objects: { first: { visible: true } },
      getAABB: () => new Float64Array([0, 0, 0, 10, 20, 30]),
      render: () => calls.push("render"),
    },
  };
  const originalFetch = globalThis.fetch;
  const originalAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => content });
  globalThis.requestAnimationFrame = (callback) => callback();

  try {
    const controller = createModelController({ viewer, loader: { load: () => model } });
    const added = controller.add({
      modelId: "model-hot-add",
      format: "xkt",
      artifactUrl: "https://viewer.invalid/content",
      selectionReferenceUrl: "https://viewer.invalid/selection-references",
      contentHash,
      preserveCamera: true,
    });
    await waitForLoadedHandler(handlers);
    handlers.loaded();
    await added;

    assert.equal(viewer.camera.projection, "perspective");
    assert.equal(calls.includes("fit"), false);
    assert.equal(calls.includes("resize"), false);
    assert.ok(calls.includes("render"));

    calls.length = 0;
    delete handlers.loaded;
    const openedForRestore = controller.open({
      modelId: "model-session-restore",
      format: "xkt",
      artifactUrl: "https://viewer.invalid/content",
      selectionReferenceUrl: "https://viewer.invalid/selection-references",
      contentHash,
      preserveCamera: true,
    });
    await waitForLoadedHandler(handlers);
    handlers.loaded();
    await openedForRestore;
    assert.equal(calls.includes("fit"), false);
    assert.equal(calls.includes("resize"), false);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.requestAnimationFrame = originalAnimationFrame;
  }
});

test("capability rotation updates access without replacing immutable model geometry", async () => {
  const content = new Uint8Array([31, 32, 33, 34]).buffer;
  const contentHash = createHash("sha256").update(Buffer.from(content)).digest("hex");
  const handlers = {};
  const calls = [];
  const model = {
    numEntities: 3,
    on: (name, handler) => { handlers[name] = handler; },
    destroy: () => calls.push("destroy"),
  };
  const viewer = { camera: {}, scene: { objects: {}, render: () => {} } };
  const originalFetch = globalThis.fetch;
  const originalAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => content });
  globalThis.requestAnimationFrame = (callback) => callback();

  try {
    const controller = createModelController({ viewer, loader: { load: () => model } });
    const descriptor = {
      modelId: "model-capability-rotation",
      revision: 7,
      format: "xkt",
      artifactUrl: "https://viewer.invalid/content",
      selectionReferenceUrl: "https://viewer.invalid/selection-references",
      requestHeaders: { "X-Artifact-Capability": "capability_token_old_123456789012" },
      contentHash,
    };
    const opened = controller.open(descriptor);
    await waitForLoadedHandler(handlers);
    handlers.loaded();
    await opened;
    const fetchBeforeRotation = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("rotated URL must not be fetched"); };

    assert.deepEqual(await controller.add({
      ...descriptor,
      artifactUrl: "https://viewer.invalid/rotated-content",
      requestHeaders: { "X-Artifact-Capability": "capability_token_new_123456789012" },
    }), { modelId: descriptor.modelId, objectCount: 3 });
    assert.equal(calls.includes("destroy"), false);
    assert.equal(controller.listDescriptors()[0].contentHash, contentHash);
    globalThis.fetch = fetchBeforeRotation;
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.requestAnimationFrame = originalAnimationFrame;
  }
});

test("removing a federated model filters its selection and reports the remaining model selection", async () => {
  const content = new Uint8Array([51, 52, 53, 54]).buffer;
  const contentHash = createHash("sha256").update(Buffer.from(content)).digest("hex");
  const handlers = [];
  const destroyed = [];
  const selectionChanges = [];
  const viewer = {
    camera: {},
    scene: {
      objects: {},
      selectedObjectIds: ["model-a#WALL-1", "model-b#DOOR-1"],
      setObjectsSelected(objectIds, selected) {
        if (!selected) this.selectedObjectIds = this.selectedObjectIds.filter((id) => !objectIds.includes(id));
      },
      render: () => {},
    },
  };
  const originalFetch = globalThis.fetch;
  const originalAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => content });
  globalThis.requestAnimationFrame = (callback) => callback();

  try {
    const controller = createModelController({
      viewer,
      loader: {
        load: ({ id }) => ({
          numEntities: 1,
          on: (name, handler) => {
            if (name === "loaded") handlers.push(handler);
          },
          destroy: () => destroyed.push(id),
        }),
      },
      onSelectionChanged: (payload) => selectionChanges.push(payload),
    });
    const first = controller.add({ modelId: "model-a", revision: 1, format: "xkt", artifactUrl: "https://viewer.invalid/a", contentHash });
    await waitForLoadedHandler({ get loaded() { return handlers[0]; } });
    handlers[0]();
    await first;
    const second = controller.add({ modelId: "model-b", revision: 1, format: "xkt", artifactUrl: "https://viewer.invalid/b", contentHash });
    await waitForLoadedHandler({ get loaded() { return handlers[1]; } });
    handlers[1]();
    await second;

    controller.remove("model-a");
    assert.deepEqual(viewer.scene.selectedObjectIds, ["model-b#DOOR-1"]);
    assert.deepEqual(selectionChanges, [{ identifiers: ["model-b#DOOR-1"], modelVersionId: "model-b" }]);
    assert.deepEqual(destroyed, ["model-a"]);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.requestAnimationFrame = originalAnimationFrame;
  }
});

test("same model identity rejects changed content and preserves the active descriptor", async () => {
  const content = new Uint8Array([35, 36, 37, 38]).buffer;
  const contentHash = createHash("sha256").update(Buffer.from(content)).digest("hex");
  const handlers = {};
  const calls = [];
  const model = { numEntities: 1, on: (name, handler) => { handlers[name] = handler; }, destroy: () => calls.push("destroy") };
  const viewer = { camera: {}, scene: { objects: {}, render: () => {} } };
  const originalFetch = globalThis.fetch;
  const originalAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => content });
  globalThis.requestAnimationFrame = (callback) => callback();

  try {
    const controller = createModelController({ viewer, loader: { load: () => model } });
    const descriptor = { modelId: "immutable-model", revision: 1, format: "xkt", artifactUrl: "https://viewer.invalid/content", contentHash };
    const opened = controller.open(descriptor);
    await waitForLoadedHandler(handlers);
    handlers.loaded();
    await opened;
    await assert.rejects(controller.add({ ...descriptor, revision: 2, contentHash: "f".repeat(64) }), /cannot be reused/);
    assert.equal(calls.includes("destroy"), false);
    assert.deepEqual(controller.listDescriptors().map(({ modelId, revision }) => ({ modelId, revision })), [{ modelId: descriptor.modelId, revision: 1 }]);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.requestAnimationFrame = originalAnimationFrame;
  }
});

test("SDK start failure rejects without retaining the rejected model", async () => {
  const content = new Uint8Array([13, 14, 15, 16]).buffer;
  const contentHash = createHash("sha256").update(Buffer.from(content)).digest("hex");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => content });

  try {
    const controller = createModelController({
      viewer: { scene: { objects: {} } },
      loader: { load: () => { throw new Error("SDK rejected model"); } },
    });
    await assert.rejects(
      controller.open({
        modelId: "model-rejected",
        format: "xkt",
        artifactUrl: "https://viewer.invalid/content",
        contentHash,
      }),
      /SDK rejected model/,
    );
    assert.deepEqual(controller.list(), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("post-loader failure destroys the rejected model and leaves no descriptor", async () => {
  const content = new Uint8Array([39, 40, 41, 42]).buffer;
  const contentHash = createHash("sha256").update(Buffer.from(content)).digest("hex");
  const handlers = {};
  const calls = [];
  const model = { on: (name, handler) => { handlers[name] = handler; }, destroy: () => calls.push("destroy") };
  const viewer = { camera: {}, scene: { objects: {}, render: () => {} } };
  const originalFetch = globalThis.fetch;
  const originalAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => content });
  globalThis.requestAnimationFrame = () => 1;

  try {
    const controller = createModelController({ viewer, loader: { load: () => model } });
    const opened = controller.add({
      modelId: "model-post-loader-failure",
      revision: 1,
      format: "xkt",
      artifactUrl: "https://viewer.invalid/content",
      contentHash,
    });
    await waitForLoadedHandler(handlers);
    handlers.error(new Error("readiness failed"));
    await assert.rejects(opened, /readiness failed/);
    assert.deepEqual(controller.list(), []);
    assert.deepEqual(controller.listDescriptors(), []);
    assert.deepEqual(calls, ["destroy"]);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.requestAnimationFrame = originalAnimationFrame;
  }
});

test("geometry watchdog completes a model when xeokit misses its loaded event", async () => {
  const content = new Uint8Array([17, 18, 19, 20]).buffer;
  const contentHash = createHash("sha256").update(Buffer.from(content)).digest("hex");
  const handlers = {};
  const model = {
    numEntities: 0,
    on: (name, handler) => { handlers[name] = handler; },
    destroy: () => {},
  };
  const viewer = {
    camera: { projection: "perspective" },
    cameraFlight: { jumpTo: () => {} },
    resize: () => {},
    scene: {
      objects: {},
      getAABB: () => new Float64Array([0, 0, 0, 1, 1, 1]),
      render: () => {},
    },
  };
  const originalFetch = globalThis.fetch;
  const originalAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => content });
  globalThis.requestAnimationFrame = (callback) => callback();

  try {
    const controller = createModelController({
      viewer,
      loader: {
        load: () => {
          viewer.scene.objects.loadedWithoutModelPrefix = {
            id: "loadedWithoutModelPrefix",
            aabb: [0, 0, 0, 1, 1, 1],
            visible: true,
          };
          return model;
        },
      },
    });
    const result = await controller.open({
      modelId: "model-watchdog",
      format: "xkt",
      artifactUrl: "https://viewer.invalid/content",
      contentHash,
    });
    assert.equal(typeof handlers.loaded, "function");
    assert.deepEqual(result, { modelId: "model-watchdog", objectCount: 1 });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.requestAnimationFrame = originalAnimationFrame;
  }
});

test("geometry watchdog waits for late scene objects before freezing the reveal snapshot", async () => {
  const content = new Uint8Array([81, 82, 83, 84]).buffer;
  const contentHash = createHash("sha256").update(Buffer.from(content)).digest("hex");
  const modelId = "model-late-geometry";
  const model = {
    numEntities: 0,
    on: () => {},
    destroy: () => {},
  };
  const viewer = {
    camera: { projection: "perspective" },
    cameraFlight: { jumpTo: () => {} },
    resize: () => {},
    scene: {
      objects: {},
      getAABB: () => new Float64Array([0, 0, 0, 2, 2, 2]),
      render: () => {},
    },
  };
  const originalFetch = globalThis.fetch;
  const originalAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => content });
  globalThis.requestAnimationFrame = (callback) => callback();
  let lateObjectTimer;

  try {
    const controller = createModelController({
      viewer,
      loader: {
        load: () => {
          viewer.scene.objects[`${modelId}#LOW`] = {
            id: `${modelId}#LOW`,
            aabb: [0, 0, 0, 1, 1, 1],
            visible: true,
          };
          lateObjectTimer = globalThis.setTimeout(() => {
            viewer.scene.objects[`${modelId}#HIGH`] = {
              id: `${modelId}#HIGH`,
              aabb: [0, 1, 0, 1, 2, 1],
              visible: true,
            };
          }, 350);
          return model;
        },
      },
    });
    const result = await controller.open({
      modelId,
      format: "xkt",
      artifactUrl: "https://viewer.invalid/content",
      contentHash,
    });
    assert.deepEqual(result, { modelId, objectCount: 2 });
    assert.equal(viewer.scene.objects[`${modelId}#LOW`].visible, true);
    assert.equal(viewer.scene.objects[`${modelId}#HIGH`].visible, true);
  } finally {
    if (lateObjectTimer) globalThis.clearTimeout(lateObjectTimer);
    globalThis.fetch = originalFetch;
    globalThis.requestAnimationFrame = originalAnimationFrame;
  }
});

test("geometry watchdog uses new scene objects before inspecting unstable model accessors", async () => {
  const content = new Uint8Array([21, 22, 23, 24]).buffer;
  const contentHash = createHash("sha256").update(Buffer.from(content)).digest("hex");
  const model = {
    get numEntities() { throw new Error("Model entity count is not finalized."); },
    on: () => {},
    destroy: () => {},
  };
  const viewer = {
    camera: { projection: "perspective" },
    cameraFlight: { jumpTo: () => {} },
    resize: () => {},
    scene: {
      objects: {},
      getAABB: () => new Float64Array([0, 0, 0, 1, 1, 1]),
      render: () => {},
    },
  };
  const originalFetch = globalThis.fetch;
  const originalAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => content });
  globalThis.requestAnimationFrame = (callback) => callback();

  try {
    const controller = createModelController({
      viewer,
      loader: {
        load: () => {
          viewer.scene.objects.createdDuringFinalize = {
            id: "createdDuringFinalize",
            aabb: [0, 0, 0, 1, 1, 1],
            visible: true,
          };
          return model;
        },
      },
    });
    const result = await controller.open({
      modelId: "model-unstable-accessor",
      format: "xkt",
      artifactUrl: "https://viewer.invalid/content",
      contentHash,
    });
    assert.deepEqual(result, { modelId: "model-unstable-accessor", objectCount: 1 });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.requestAnimationFrame = originalAnimationFrame;
  }
});

test("model readiness survives a transient post-load presentation fault", async () => {
  const content = new Uint8Array([25, 26, 27, 28]).buffer;
  const contentHash = createHash("sha256").update(Buffer.from(content)).digest("hex");
  const handlers = {};
  const model = { numEntities: 1, on: (name, handler) => { handlers[name] = handler; }, destroy: () => {} };
  const viewer = {
    camera: { projection: "perspective" },
    cameraFlight: { jumpTo: () => { throw new Error("Camera frame is still finalizing."); } },
    resize: () => {},
    scene: {
      objects: { visible: { visible: true } },
      getAABB: () => new Float64Array([0, 0, 0, 1, 1, 1]),
      render: () => { throw new Error("Render frame is still finalizing."); },
    },
  };
  const originalFetch = globalThis.fetch;
  const originalAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => content });
  globalThis.requestAnimationFrame = (callback) => callback();

  try {
    const controller = createModelController({ viewer, loader: { load: () => model } });
    const opened = controller.open({
      modelId: "model-transient-presentation",
      format: "xkt",
      artifactUrl: "https://viewer.invalid/content",
      contentHash,
    });
    await waitForLoadedHandler(handlers);
    handlers.loaded();
    assert.deepEqual(await opened, { modelId: "model-transient-presentation", objectCount: 1 });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.requestAnimationFrame = originalAnimationFrame;
  }
});

test("selection references are created by the Viewer origin and stay opaque", async () => {
  const content = new Uint8Array([9, 10, 11, 12]).buffer;
  const contentHash = createHash("sha256").update(Buffer.from(content)).digest("hex");
  const handlers = {};
  const model = { on: (name, handler) => { handlers[name] = handler; }, destroy: () => {} };
  const viewer = {
    camera: { projection: "perspective" },
    scene: {
      objects: { first: { visible: true } },
      getAABB: () => new Float64Array([0, 0, 0, 1, 1, 1]),
      render: () => {},
    },
  };
  const originalFetch = globalThis.fetch;
  const originalAnimationFrame = globalThis.requestAnimationFrame;
  const calls = [];
  globalThis.requestAnimationFrame = (callback) => callback();
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === "POST") {
      return { ok: true, json: async () => ({ references: ["selection.session.12345678901234567890"] }) };
    }
    return { ok: true, arrayBuffer: async () => content };
  };

  try {
    const controller = createModelController({ viewer, loader: { load: () => model } });
    const opened = controller.open({
      modelId: "model.123456789012",
      format: "xkt",
      artifactUrl: "https://viewer.invalid/content",
      selectionReferenceUrl: "https://viewer.invalid/selection-references",
      requestHeaders: { "X-Artifact-Capability": "capability_token_12345678901234567890" },
      contentHash,
    });
    await waitForLoadedHandler(handlers);
    handlers.loaded();
    await opened;

    const rawObjectId = "model.123456789012#WALL-001";
    const references = await controller.createSelectionReferences([rawObjectId]);
    const referenceCall = calls.find((call) => call.options.method === "POST");
    assert.deepEqual(references, ["selection.session.12345678901234567890"]);
    assert.equal(referenceCall.url, "https://viewer.invalid/selection-references");
    assert.equal(referenceCall.options.headers["X-Artifact-Capability"], "capability_token_12345678901234567890");
    assert.equal(referenceCall.options.body.includes(rawObjectId), true);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.requestAnimationFrame = originalAnimationFrame;
  }
});
