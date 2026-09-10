import test from "node:test";
import assert from "node:assert/strict";
import { buildObjectLabelRows } from "../../packages/viewer/src/xeokit/labels.js";

test("object labels expose bounded display names and top-of-object positions", () => {
  const viewer = {
    metaScene: {
      metaObjects: {
        "model#wall-1": { name: "Tường phía Đông" },
        "model#wall-2": { externalId: "EXT-002" },
      },
    },
    scene: {
      objects: {
        "model#wall-1": { aabb: [0, 0, 0, 4, 3, 2] },
        "model#wall-2": { aabb: [2, 1, 2, 3, 2, 4] },
      },
    },
  };

  assert.deepEqual(buildObjectLabelRows(viewer, [
    "model#wall-1",
    "model#wall-1",
    "model#wall-2",
    "missing",
  ]), [
    { objectId: "model#wall-1", label: "Tường phía Đông", worldPos: [2, 3, 1] },
    { objectId: "model#wall-2", label: "EXT-002", worldPos: [2.5, 2, 3] },
  ]);
});
