import test from "node:test";
import assert from "node:assert/strict";
import {
  buildIfcSpaceMembershipVolume,
  classifyVisibleObjectsBySpaceMembership,
} from "../../packages/viewer/src/xeokit/space-clip-geometry.js";

function makeConcavePrism() {
  const footprint = [[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3]];
  const bottom = footprint.map(([x, z]) => [x, 0, z]);
  const points = [...bottom, ...bottom.map(([x, , z]) => [x, 2, z])];
  const positions = points.flat();
  const indices = [
    0, 1, 3, 1, 2, 3, 0, 3, 5, 3, 4, 5,
    6, 9, 7, 7, 9, 8, 6, 11, 9, 9, 11, 10,
  ];
  for (let index = 0; index < footprint.length; index += 1) {
    const next = (index + 1) % footprint.length;
    indices.push(index, next, 6 + next, index, 6 + next, 6 + index);
  }
  return {
    aabb: [0, 0, 0, 3, 2, 3],
    meshes: [{ portionId: 0, layer: { readGeometryData: () => ({ positions, indices }) } }],
  };
}

test("concave IfcSpace membership uses its true footprint, not its AABB", async () => {
  const volume = buildIfcSpaceMembershipVolume(makeConcavePrism());
  assert.equal(volume.ok, true);
  assert.equal(volume.floorElevation, 0);
  assert.equal(volume.ceilingElevation, 2);
  const progress = [];
  const result = await classifyVisibleObjectsBySpaceMembership({
    objects: {
      selected: { id: "selected", visible: true, aabb: [0, 0, 0, 3, 2, 3] },
      inside: { id: "inside", visible: true, aabb: [0.2, 0.2, 0.2, 0.8, 1.8, 0.8] },
      inNotch: { id: "inNotch", visible: true, aabb: [1.5, 0.2, 1.5, 1.8, 1.8, 1.8] },
      boundary: { id: "boundary", visible: true, aabb: [0.8, 0.2, 0.8, 1.2, 1.8, 1.2] },
      above: { id: "above", visible: true, aabb: [0.2, 3, 0.2, 0.8, 4, 0.8] },
    },
  }, volume, { excludeObjectId: "selected", batchSize: 1, onProgress: (entry) => progress.push(entry) });
  assert.equal(result.cancelled, false);
  assert.equal(result.retainedObjectCount, 3);
  assert.deepEqual(result.hiddenObjectIds, ["inNotch"]);
  assert.equal(progress.at(-1).scannedObjectCount, 4);
});

test("membership delegates vertical clipping to the floor and ceiling planes", async () => {
  const volume = buildIfcSpaceMembershipVolume(makeConcavePrism());
  const result = await classifyVisibleObjectsBySpaceMembership({
    objects: {
      selected: { id: "selected", visible: true, aabb: [0, 0, 0, 3, 2, 3] },
      aboveRoom: { id: "aboveRoom", visible: true, aabb: [0.2, 3, 0.2, 0.8, 4, 0.8] },
    },
  }, volume, { excludeObjectId: "selected" });
  assert.deepEqual(result.hiddenObjectIds, []);
  assert.equal(result.retainedObjectCount, 1);
});

test("space membership rejects unreadable geometry instead of falling back to a box", () => {
  assert.deepEqual(
    buildIfcSpaceMembershipVolume({ aabb: [0, 0, 0, 1, 1, 1], meshes: [] }),
    { ok: false, reason: "SPACE_GEOMETRY_UNAVAILABLE" },
  );
});
