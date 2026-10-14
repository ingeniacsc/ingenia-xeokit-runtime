import test from "node:test";
import assert from "node:assert/strict";
import { normalizeZoneGroups as normalize, buildZoneTreeGroups } from "../../packages/viewer/src/xeokit/zone-groups.js";
const normalizeZoneGroups = (groups, scope) => normalize(groups, scope, "version-a");

const group = { id: "zone-a", code: "ZONE-A", name: "Zone A", objectIds: ["wall", "slab", "wall"],
  zoneSetId: "set-a", publishedSnapshotId: "snapshot-a", modelVersionId: "version-a", objectCount: 2 };

test("zone contract rejects missing snapshot, wrong version and inaccurate counts", () => {
  for (const patch of [{ zoneSetId: null }, { publishedSnapshotId: undefined },
    { modelVersionId: "version-b" }, { objectCount: 3 }]) {
    assert.equal(normalizeZoneGroups([{ ...group, ...patch }], { mode: "all" }), null);
  }
  const objectIds = Array.from({ length: 14001 }, (_, index) => `guid-${index}`);
  const result = normalizeZoneGroups([{ ...group, objectIds, objectCount: objectIds.length }], { mode: "all" });
  assert.equal(result[0].objectCount, 14001);
  assert.equal(result[0].objectIds.at(-1), "guid-14000");
  assert.equal(result[0].publishedSnapshotId, "snapshot-a");
});

test("optional zone metadata never expands geometry authority", () => {
  const groups = normalizeZoneGroups([group], { mode: "allowlist", allowedObjectIds: ["wall"] });
  assert.deepEqual(groups[0].objectIds, ["wall"]);
  assert.deepEqual(normalizeZoneGroups([group], { mode: "allowlist", allowedObjectIds: [] }), []);
  assert.equal(normalizeZoneGroups([group], { mode: "invalid" }), null);
  assert.deepEqual(normalizeZoneGroups([group], { mode: "all" })[0].objectIds, ["wall", "slab"]);
});

test("missing, malformed and oversized optional metadata is unavailable without a partial list", () => {
  for (const groups of [undefined, {}, [group, group], [group, { ...group, id: "zone-b", objectIds: ["other-model#wall"] }],
    [{ ...group, code: "bad\ncode" }], [{ ...group, objectIds: [null] }], Array(1001).fill(group),
    [{ ...group, objectIds: Array(500001).fill("wall") }]]) {
    assert.equal(normalizeZoneGroups(groups, { mode: "all" }), null);
  }
  assert.deepEqual(normalizeZoneGroups([], { mode: "all" }), []);
});

test("zone, storey and class intersection preserves version-specific GUID identity", () => {
  const floor = { id: "a#floor", type: "IfcBuildingStorey", name: "Tầng 1" };
  const beam = { id: "a#beam", type: "IfcBeam" };
  // Malformed parent loops are bounded and fall back to unassigned storey.
  beam.parent = beam;
  const viewer = {
    scene: { objects: { "a#wall": {}, "a#beam": {}, "b#wall": {}, "a#outside": {} } },
    metaScene: { metaObjects: { "a#floor": floor, "a#wall": { type: "IfcWall", parent: "a#floor" }, "a#beam": beam } },
  };
  const groups = buildZoneTreeGroups(viewer, [
    { modelId: "a", displayName: "Version A", zoneGroups: [{ ...group, objectIds: ["wall", "beam", "missing"] }] },
    { modelId: "b", displayName: "Version B", zoneGroups: [{ ...group, objectIds: ["wall"] }] },
  ], "Chưa xác định tầng");
  assert.deepEqual(groups.map((g) => g.objectIds), [["a#wall", "a#beam"], ["b#wall"]]);
  assert.deepEqual(groups[0].storeys.find((s) => s.label === "Tầng 1").types.get("IfcWall"), ["a#wall"]);
  assert.deepEqual(groups[0].storeys.find((s) => s.label === "Chưa xác định tầng").objectIds, ["a#beam"]);
  assert.equal(groups.some((g) => g.objectIds.includes("a#outside")), false);
  assert.deepEqual(buildZoneTreeGroups(viewer, [{ modelId: "a", zoneGroups: [] }]), []);
});
