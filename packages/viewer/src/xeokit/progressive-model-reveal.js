// SPDX-License-Identifier: AGPL-3.0-only

const VERTICAL_AXIS = 1;
const DEFAULT_TARGET_BATCH_COUNT = 12;
const MIN_BATCH_SIZE = 16;
const MAX_BATCH_SIZE = 400;

function objectElevation(sceneObject) {
  const aabb = Array.from(sceneObject?.aabb || []);
  if (aabb.length !== 6 || !aabb.every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  return aabb[VERTICAL_AXIS];
}

export function orderSceneObjectsBottomUp(sceneObjects) {
  return (Array.isArray(sceneObjects) ? sceneObjects : [])
    .filter((sceneObject) => sceneObject?.id)
    .map((sceneObject, index) => ({ sceneObject, index, elevation: objectElevation(sceneObject) }))
    .sort((left, right) => (
      left.elevation - right.elevation
      || left.index - right.index
    ))
    .map(({ sceneObject }) => sceneObject);
}

export function createBottomUpRevealBatches(sceneObjects, {
  targetBatchCount = DEFAULT_TARGET_BATCH_COUNT,
  minBatchSize = MIN_BATCH_SIZE,
  maxBatchSize = MAX_BATCH_SIZE,
} = {}) {
  const ordered = orderSceneObjectsBottomUp(sceneObjects);
  if (ordered.length === 0) return [];
  const safeTargetCount = Math.max(1, Number(targetBatchCount) || DEFAULT_TARGET_BATCH_COUNT);
  const batchSize = Math.max(
    Math.max(1, Number(minBatchSize) || MIN_BATCH_SIZE),
    Math.min(
      Math.max(1, Number(maxBatchSize) || MAX_BATCH_SIZE),
      Math.ceil(ordered.length / safeTargetCount),
    ),
  );
  const batches = [];
  for (let index = 0; index < ordered.length; index += batchSize) {
    batches.push(ordered.slice(index, index + batchSize));
  }
  return batches;
}

export async function revealSceneObjectsBottomUp(sceneObjects, {
  onBatch,
  scheduleFrame,
} = {}) {
  const batches = createBottomUpRevealBatches(sceneObjects);
  let revealedCount = 0;
  for (const batch of batches) {
    await new Promise((resolve) => scheduleFrame(resolve));
    revealedCount += batch.length;
    onBatch?.({
      batch,
      revealedCount,
      totalCount: sceneObjects.length,
    });
  }
  return revealedCount;
}
