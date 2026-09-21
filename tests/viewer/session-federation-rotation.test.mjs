import test from "node:test";
import assert from "node:assert/strict";

import { createViewerSessionController } from "../../packages/viewer/src/xeokit/session.js";

function createStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, value); },
  };
}

test("export rotates stateRef when the authorized federation fingerprint changes", () => {
  let models = [{ modelId: "model-a", revision: 1, contentHash: "a".repeat(64) }];
  let sequence = 0;
  const controller = createViewerSessionController({
    storage: createStorage(),
    idFactory: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    clock: () => 1_788_023_000_000 + sequence,
    getLoadedModels: () => models,
    readGraphicsState: () => ({
      appearance: { colorMode: "source", dayNightMode: "day" },
      camera: { eye: [10, 10, 10], look: [0, 0, 0], up: [0, 1, 0], projection: "perspective" },
      navigation: "orbit",
    }),
  });

  const first = controller.export();
  assert.equal(controller.export().stateRef, first.stateRef);
  models = [{ modelId: "model-b", revision: 2, contentHash: "b".repeat(64) }];
  assert.notEqual(controller.export().stateRef, first.stateRef);
});
