import test from "node:test";
import assert from "node:assert/strict";

import {
  createBottomUpRevealBatches,
  orderSceneObjectsBottomUp,
  revealSceneObjectsBottomUp,
} from "../../packages/viewer/src/xeokit/progressive-model-reveal.js";

test("scene objects are ordered from lower to higher elevation with stable fallbacks", () => {
  const objects = [
    { id: "level-2", aabb: [0, 8, 0, 1, 9, 1] },
    { id: "unknown" },
    { id: "basement", aabb: [0, -4, 0, 1, -3, 1] },
    { id: "level-1", aabb: [0, 3, 0, 1, 4, 1] },
  ];

  assert.deepEqual(
    orderSceneObjectsBottomUp(objects).map(({ id }) => id),
    ["basement", "level-1", "level-2", "unknown"],
  );
});

test("bottom-up reveal keeps compact batches and yields before every visible batch", async () => {
  const objects = Array.from({ length: 35 }, (_, index) => ({
    id: `object-${index}`,
    aabb: [0, 34 - index, 0, 1, 35 - index, 1],
  }));
  const batches = createBottomUpRevealBatches(objects, {
    targetBatchCount: 4,
    minBatchSize: 2,
    maxBatchSize: 10,
  });
  assert.equal(batches.length, 4);
  assert.equal(batches[0][0].id, "object-34");

  const events = [];
  await revealSceneObjectsBottomUp(objects.slice(0, 3), {
    scheduleFrame: (callback) => { events.push("frame"); callback(); },
    onBatch: ({ batch, revealedCount, totalCount }) => events.push({
      ids: batch.map(({ id }) => id),
      revealedCount,
      totalCount,
    }),
  });
  assert.deepEqual(events, [
    "frame",
    { ids: ["object-2", "object-1", "object-0"], revealedCount: 3, totalCount: 3 },
  ]);
});
