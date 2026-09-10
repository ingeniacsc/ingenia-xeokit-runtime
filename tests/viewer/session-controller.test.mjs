import test from "node:test";
import assert from "node:assert/strict";

import {
  VIEWER_SESSION_MAX_STORED_BYTES,
  VIEWER_SESSION_MAX_STORED_ENTRIES,
  VIEWER_SESSION_SCHEMA_VERSION,
  VIEWER_SESSION_TTL_MS,
  ViewerSessionStateError,
  createViewerSessionController,
} from "../../packages/viewer/src/xeokit/session.js";

function createStorage() {
  const values = new Map();
  return {
    values,
    get length() { return values.size; },
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

function createHarness(overrides = {}) {
  let now = 1_000_000;
  let loadedModels = [
    { modelId: "model-b", revision: "rev-2", contentHash: "b".repeat(64) },
    { modelId: "model-a", revision: "rev-1", contentHash: "a".repeat(64) },
  ];
  let graphicsState = {
    camera: {
      eye: new Float64Array([10, 20, 30]),
      look: [1, 2, 3],
      up: [0, 1, 0],
      projection: "ortho",
    },
    selection: ["model-a#selected", "model-a#stale-selection"],
    hiddenObjectIds: ["model-b#hidden", "model-b#stale-hidden"],
    navigation: "walk",
    appearance: {
      colorMode: "ifc",
      dayNightMode: "night",
      businessStatuses: [{ objectId: "must-not-persist" }],
    },
    labels: {
      enabled: true,
      identifiers: ["model-a#selected", "model-a#stale-label"],
      metadata: { privateValue: "must-not-persist" },
    },
    section: {
      id: "primary-section",
      pos: [4, 5, 6],
      dir: [0, -1, 0],
      businessData: "must-not-persist",
    },
    artifactUrl: "https://viewer.invalid/private-artifact",
    requestHeaders: { Authorization: "Bearer secret" },
    capabilityToken: "secret-capability",
    metadata: { dossier: "private-business-data" },
  };
  const calls = [];
  const storage = overrides.storage || createStorage();
  const viewer = overrides.viewer || {
    camera: {
      eye: [0, 0, 10],
      look: [0, 0, 0],
      up: [0, 1, 0],
      projection: "perspective",
    },
    cameraControl: { navMode: "orbit", constrainVertical: false },
    scene: {
      models: { "model-a": {}, "model-b": {} },
      objects: {
        "model-a#selected": { id: "model-a#selected" },
        "model-b#hidden": { id: "model-b#hidden" },
      },
      selectedObjectIds: [],
    },
  };
  const controllers = {
    camera: {
      set: (payload) => calls.push(["camera.set", payload]),
      navigation: (mode) => calls.push(["camera.navigation", mode]),
    },
    selection: {
      clear: () => calls.push(["selection.clear"]),
      select: (identifiers) => calls.push(["selection.select", identifiers]),
    },
    visibility: {
      reset: () => calls.push(["visibility.reset"]),
      hide: (identifiers) => calls.push(["visibility.hide", identifiers]),
      hiddenObjectIds: () => graphicsState.hiddenObjectIds || [],
    },
    appearance: {
      apply: (payload) => calls.push(["appearance.apply", payload]),
      dayNight: (mode) => calls.push(["appearance.dayNight", mode]),
    },
    labels: {
      mode: (enabled, identifiers) => calls.push(["labels.mode", enabled, identifiers]),
    },
    spatial: {
      setSection: (payload) => calls.push(["spatial.setSection", payload]),
      clearSection: () => calls.push(["spatial.clearSection"]),
    },
  };
  const controller = createViewerSessionController({
    viewer,
    storage,
    idFactory: overrides.idFactory || (() => "0000000000000001"),
    clock: () => now,
    getLoadedModels: () => loadedModels,
    readGraphicsState: () => graphicsState,
    isCoarsePointer: overrides.isCoarsePointer || (() => false),
    ...controllers,
    ...overrides.controllers,
  });
  return {
    calls,
    controller,
    storage,
    viewer,
    setGraphicsState: (value) => { graphicsState = value; },
    setLoadedModels: (value) => { loadedModels = value; },
    setNow: (value) => { now = value; },
  };
}

function onlyStoredEntry(storage) {
  assert.equal(storage.values.size, 1);
  return Array.from(storage.values.entries())[0];
}

function assertSessionError(operation, code) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof ViewerSessionStateError);
    assert.equal(error.code, code);
    return true;
  });
}

test("export stores only a bounded neutral Viewer-origin snapshot", () => {
  const harness = createHarness();
  const reference = harness.controller.export();

  assert.deepEqual(reference, {
    schemaVersion: VIEWER_SESSION_SCHEMA_VERSION,
    stateRef: "viewstate.session.0000000000000001",
    createdAt: 1_000_000,
    presentation: {
      navigationMode: "walk",
      visualMode: "night",
      colorMode: "ifc",
    },
  });
  assert.deepEqual(
    Object.keys(reference).slice(0, 3),
    ["schemaVersion", "stateRef", "createdAt"],
  );
  assert.equal(JSON.stringify(reference).includes("model-a#selected"), false);
  assert.deepEqual(
    Object.keys(reference.presentation),
    ["navigationMode", "visualMode", "colorMode"],
  );
  assert.doesNotMatch(JSON.stringify(reference.presentation), /#|identifier|object|model|revision|hash/i);

  const [storageKey, serialized] = onlyStoredEntry(harness.storage);
  assert.equal(storageKey.endsWith(reference.stateRef), true);
  assert.ok(new TextEncoder().encode(serialized).byteLength <= VIEWER_SESSION_MAX_STORED_BYTES);
  const snapshot = JSON.parse(serialized);
  assert.deepEqual(snapshot, {
    schemaVersion: VIEWER_SESSION_SCHEMA_VERSION,
    createdAt: 1_000_000,
    models: [
      { modelId: "model-a", revision: "rev-1", contentHash: "a".repeat(64) },
      { modelId: "model-b", revision: "rev-2", contentHash: "b".repeat(64) },
    ],
    graphics: {
      camera: {
        eye: [10, 20, 30],
        look: [1, 2, 3],
        up: [0, 1, 0],
        projection: "ortho",
      },
      navigation: "walk",
      appearance: { colorMode: "ifc", dayNightMode: "night" },
    },
  });
  assert.doesNotMatch(
    serialized,
    /selection|hidden|isolate|labels|section|measurement|panel|context|fullscreen|artifactUrl|Authorization|capabilityToken|dossier|businessStatuses|businessData|metadata/i,
  );
});

test("import resets transient object state and restores only durable presentation", () => {
  const harness = createHarness();
  const reference = harness.controller.export();
  harness.calls.length = 0;

  assert.deepEqual(harness.controller.import(reference.stateRef), reference);
  assert.deepEqual(harness.calls, [
    ["visibility.reset"],
    ["selection.clear"],
    ["camera.navigation", "walk"],
    ["camera.set", {
      eye: [10, 20, 30],
      look: [1, 2, 3],
      up: [0, 1, 0],
      projection: "ortho",
    }],
    ["appearance.apply", { options: { mode: "ifc" } }],
    ["appearance.dayNight", "night"],
  ]);
  assert.doesNotMatch(JSON.stringify(harness.calls), /model-[ab]#/);
});

test("import accepts only a bounded opaque stateRef", () => {
  let reads = 0;
  const storage = createStorage();
  const originalGetItem = storage.getItem;
  storage.getItem = (key) => {
    reads += 1;
    return originalGetItem(key);
  };
  const harness = createHarness({ storage });

  for (const candidate of [
    "raw-model#guid",
    "short",
    "x".repeat(129),
    { stateRef: "viewstate.session.0000000000000001" },
  ]) {
    assertSessionError(() => harness.controller.import(candidate), "INVALID_STATE_REF");
  }
  assert.equal(reads, 0);
  assert.deepEqual(harness.calls, []);
});

test("missing, malformed and unknown stored state fails closed", () => {
  const missing = createHarness();
  assertSessionError(
    () => missing.controller.import("viewstate.session.missing000000000"),
    "STATE_NOT_FOUND",
  );
  assert.deepEqual(missing.calls, []);

  const malformed = createHarness();
  const reference = malformed.controller.export();
  const [key] = onlyStoredEntry(malformed.storage);
  malformed.storage.setItem(key, "{bad json");
  malformed.calls.length = 0;
  assertSessionError(() => malformed.controller.import(reference.stateRef), "MALFORMED_STATE");
  assert.deepEqual(malformed.calls, []);

  const unknown = createHarness();
  const unknownReference = unknown.controller.export();
  const [unknownKey, unknownRaw] = onlyStoredEntry(unknown.storage);
  unknown.storage.setItem(unknownKey, JSON.stringify({
    ...JSON.parse(unknownRaw),
    artifactUrl: "https://viewer.invalid/private",
  }));
  unknown.calls.length = 0;
  assertSessionError(() => unknown.controller.import(unknownReference.stateRef), "MALFORMED_STATE");
  assert.deepEqual(unknown.calls, []);
});

test("expired, future and schema-mismatched state fails closed", () => {
  const expired = createHarness();
  const expiredReference = expired.controller.export();
  expired.setNow(expiredReference.createdAt + VIEWER_SESSION_TTL_MS + 1);
  assertSessionError(() => expired.controller.import(expiredReference.stateRef), "STATE_EXPIRED");
  assert.deepEqual(expired.calls, []);

  const future = createHarness();
  const futureReference = future.controller.export();
  future.setNow(futureReference.createdAt - 30_001);
  assertSessionError(() => future.controller.import(futureReference.stateRef), "MALFORMED_STATE");
  assert.deepEqual(future.calls, []);

  const schema = createHarness();
  const schemaReference = schema.controller.export();
  const [schemaKey, schemaRaw] = onlyStoredEntry(schema.storage);
  schema.storage.setItem(schemaKey, JSON.stringify({
    ...JSON.parse(schemaRaw),
    schemaVersion: VIEWER_SESSION_SCHEMA_VERSION + 1,
  }));
  schema.calls.length = 0;
  assertSessionError(() => schema.controller.import(schemaReference.stateRef), "SCHEMA_MISMATCH");
  assert.deepEqual(schema.calls, []);
});

test("model revision and content-hash mismatches fail atomically", () => {
  for (const changedModel of [
    { modelId: "model-a", revision: "rev-new", contentHash: "a".repeat(64) },
    { modelId: "model-a", revision: "rev-1", contentHash: "c".repeat(64) },
  ]) {
    const harness = createHarness();
    const reference = harness.controller.export();
    harness.setLoadedModels([
      changedModel,
      { modelId: "model-b", revision: "rev-2", contentHash: "b".repeat(64) },
    ]);
    harness.calls.length = 0;

    assertSessionError(() => harness.controller.import(reference.stateRef), "MODEL_SET_MISMATCH");
    assert.deepEqual(harness.calls, []);
  }
});

test("a stateRef can be imported successfully only once per controller session", () => {
  const harness = createHarness();
  const reference = harness.controller.export();
  harness.controller.import(reference.stateRef);
  harness.calls.length = 0;

  assertSessionError(
    () => harness.controller.import(reference.stateRef),
    "STATE_REF_ALREADY_IMPORTED",
  );
  assert.deepEqual(harness.calls, []);
});

test("restore preflights every required controller before applying state", () => {
  const harness = createHarness({ controllers: { selection: {} } });
  const reference = harness.controller.export();
  harness.calls.length = 0;

  assertSessionError(() => harness.controller.import(reference.stateRef), "CONTROLLER_UNAVAILABLE");
  assert.deepEqual(harness.calls, []);
});

test("repeated export reuses one stateRef and refreshes the stored snapshot", () => {
  let factoryCalls = 0;
  const harness = createHarness({
    idFactory: () => {
      factoryCalls += 1;
      return "reused0000000001";
    },
  });
  const first = harness.controller.export();
  harness.setNow(first.createdAt + 5_000);
  harness.setGraphicsState({
    camera: {
      eye: [90, 80, 70],
      look: [9, 8, 7],
      up: [0, 1, 0],
      projection: "perspective",
    },
    navigation: "fly",
    appearance: { colorMode: "business", dayNightMode: "day" },
  });

  const second = harness.controller.export();
  assert.equal(second.stateRef, first.stateRef);
  assert.equal(second.createdAt, first.createdAt + 5_000);
  assert.equal(second.presentation.colorMode, "source");
  assert.equal(factoryCalls, 1);
  assert.equal(harness.storage.values.size, 1);
  const [, serialized] = onlyStoredEntry(harness.storage);
  const snapshot = JSON.parse(serialized);
  assert.equal(snapshot.createdAt, second.createdAt);
  assert.deepEqual(snapshot.graphics.camera.eye, [90, 80, 70]);
  assert.equal(snapshot.graphics.navigation, "fly");
  assert.equal(snapshot.graphics.appearance.colorMode, "source");
});

test("successful import adopts the imported stateRef for later overwrites", () => {
  const storage = createStorage();
  const source = createHarness({ storage, idFactory: () => "source0000000001" });
  const reference = source.controller.export();
  let replacementFactoryCalls = 0;
  const restored = createHarness({
    storage,
    idFactory: () => {
      replacementFactoryCalls += 1;
      return "replacement000001";
    },
  });
  restored.controller.import(reference.stateRef);
  restored.setNow(reference.createdAt + 10_000);

  const refreshed = restored.controller.export();
  assert.equal(refreshed.stateRef, reference.stateRef);
  assert.equal(refreshed.createdAt, reference.createdAt + 10_000);
  assert.equal(replacementFactoryCalls, 0);
  assert.equal(storage.values.size, 1);
});

test("coarse pointers downgrade restored walk and fly navigation to orbit", () => {
  for (const navigation of ["walk", "fly"]) {
    const harness = createHarness({ isCoarsePointer: () => true });
    harness.setGraphicsState({
      camera: {
        eye: [10, 20, 30],
        look: [1, 2, 3],
        up: [0, 1, 0],
        projection: "ortho",
      },
      navigation,
      appearance: { colorMode: "ifc", dayNightMode: "night" },
    });
    const reference = harness.controller.export();
    harness.calls.length = 0;

    const restored = harness.controller.import(reference.stateRef);
    assert.equal(restored.presentation.navigationMode, "orbit");
    assert.deepEqual(
      harness.calls.find(([name]) => name === "camera.navigation"),
      ["camera.navigation", "orbit"],
    );
  }
});

test("import refuses stored snapshots that exceed the byte limit", () => {
  const harness = createHarness();
  const reference = harness.controller.export();
  const [key] = onlyStoredEntry(harness.storage);
  harness.storage.setItem(key, "x".repeat(VIEWER_SESSION_MAX_STORED_BYTES + 1));
  harness.calls.length = 0;

  assertSessionError(() => harness.controller.import(reference.stateRef), "STATE_TOO_LARGE");
  assert.deepEqual(harness.calls, []);
});

test("storage failures do not expose or partially apply graphics state", () => {
  const writeFailure = createStorage();
  writeFailure.setItem = () => { throw new Error("quota"); };
  const exporting = createHarness({ storage: writeFailure });
  assertSessionError(() => exporting.controller.export(), "STORAGE_WRITE_FAILED");

  const reading = createHarness();
  const reference = reading.controller.export();
  reading.calls.length = 0;
  reading.storage.getItem = () => { throw new Error("blocked"); };
  assertSessionError(() => reading.controller.import(reference.stateRef), "STORAGE_READ_FAILED");
  assert.deepEqual(reading.calls, []);
});

test("restore rolls back every partially applied graphics operation", () => {
  const operationNames = [
    "visibility.reset", "selection.clear", "camera.set",
    "camera.navigation", "appearance.apply", "appearance.dayNight",
  ];
  operationNames.forEach((failedOperation) => {
    const storage = createStorage();
    const state = {
      camera: { eye: [3, 4, 5], look: [0, 0, 0], up: [0, 1, 0], projection: "perspective" },
      navigation: "orbit",
      appearance: { colorMode: "source", dayNightMode: "day" },
      selected: ["model-a#current"],
      hidden: ["model-b#current"],
    };
    const viewer = { scene: { get selectedObjectIds() { return state.selected; } } };
    let failOnce = true;
    const apply = (name, mutation) => {
      if (name === failedOperation && failOnce) { failOnce = false; throw new Error(name); }
      mutation();
    };
    const controller = createViewerSessionController({
      viewer, storage, idFactory: () => "rollback000000001", clock: () => 1_000_000,
      getLoadedModels: () => [
        { modelId: "model-a", revision: "rev-1", contentHash: "a".repeat(64) },
      ],
      readGraphicsState: () => state,
      visibility: {
        hiddenObjectIds: () => state.hidden,
        reset: () => apply("visibility.reset", () => { state.hidden = []; }),
        hide: (ids) => { state.hidden = [...ids]; },
      },
      selection: {
        clear: () => apply("selection.clear", () => { state.selected = []; }),
        select: (ids) => { state.selected = [...ids]; },
      },
      camera: {
        set: (value) => apply("camera.set", () => { state.camera = structuredClone(value); }),
        navigation: (value) => apply("camera.navigation", () => { state.navigation = value; }),
      },
      appearance: {
        apply: ({ options }) => apply("appearance.apply", () => { state.appearance.colorMode = options.mode; }),
        dayNight: (value) => apply("appearance.dayNight", () => { state.appearance.dayNightMode = value; }),
      },
    });
    state.camera = { eye: [30, 40, 50], look: [1, 2, 3], up: [0, 1, 0], projection: "ortho" };
    state.navigation = "walk";
    state.appearance = { colorMode: "ifc", dayNightMode: "night" };
    const reference = controller.export();
    const expected = structuredClone(state);
    state.camera = { eye: [3, 4, 5], look: [0, 0, 0], up: [0, 1, 0], projection: "perspective" };
    state.navigation = "orbit";
    state.appearance = { colorMode: "source", dayNightMode: "day" };
    state.selected = ["model-a#current"];
    state.hidden = ["model-b#current"];
    const before = structuredClone(state);
    assertSessionError(() => controller.import(reference.stateRef), "SESSION_RESTORE_FAILED");
    assert.deepEqual(state, before, `rollback after ${failedOperation}`);
    assert.notDeepEqual(state, expected);
  });
});

test("Viewer session storage removes invalid entries and remains bounded", () => {
  const storage = createStorage();
  storage.setItem("ingenia:xeokit-viewer:session:v1:invalid", "{bad json");
  for (let index = 0; index < VIEWER_SESSION_MAX_STORED_ENTRIES + 3; index += 1) {
    const harness = createHarness({
      storage,
      idFactory: () => `bounded${String(index).padStart(12, "0")}`,
    });
    harness.setNow(1_000_000 + index);
    harness.controller.export();
  }
  assert.equal(storage.values.has("ingenia:xeokit-viewer:session:v1:invalid"), false);
  assert.ok(storage.values.size <= VIEWER_SESSION_MAX_STORED_ENTRIES);

  const originalSetItem = storage.setItem;
  storage.setItem = (key, value) => {
    if (!storage.values.has(key) && storage.values.size >= VIEWER_SESSION_MAX_STORED_ENTRIES) {
      throw new Error("quota");
    }
    originalSetItem(key, value);
  };
  const replacement = createHarness({ storage, idFactory: () => "boundedreplacement01" });
  assert.doesNotThrow(() => replacement.controller.export());
  assert.equal(storage.values.size, VIEWER_SESSION_MAX_STORED_ENTRIES);
});
