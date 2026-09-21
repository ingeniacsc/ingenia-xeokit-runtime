import test from "node:test";
import assert from "node:assert/strict";
import {
  buildObjectPropertiesSnapshot,
  resolveTechnicalMatchValue,
} from "../../packages/viewer/src/xeokit/object-properties.js";

const FULL_ACCESS = Object.freeze({
  objectName: true,
  ifcType: true,
  typeName: true,
  globalId: true,
  storey: true,
  tag: true,
  propertySets: true,
});

function createViewer() {
  const wallPset = (reference, fireRating, cost = "", material = "Concrete") => ({
    name: "Pset_WallCommon",
    properties: [
      { name: "Reference", value: reference },
      { name: "Fire Rating", value: fireRating },
      { name: "Material", value: material },
      ...(cost ? [{ name: "Internal Cost", value: cost }] : []),
      { name: "Zone", value: "Podium" },
    ],
  });
  return {
    metaScene: {
      metaObjects: {
        "model-a#wall-1": { id: "model-a#wall-1", name: "Wall-001", type: "IfcWall", parent: "storey", propertySets: [wallPset("W-200", "EI60", "100")] },
        "model-a#wall-2": { id: "model-a#wall-2", name: "Wall-002", type: "IfcWall", parent: "storey", propertySets: [wallPset("W-200", "EI60", "200")] },
        "model-a#wall-3": { id: "model-a#wall-3", name: "Wall-003", type: "IfcWall", parent: "storey", propertySets: [wallPset("W-200", "EI90")] },
        "model-a#wall-4": { id: "model-a#wall-4", name: "Wall-004", type: "IfcWall", parent: "storey", propertySets: [wallPset("W-200", "EI60", "", "Steel")] },
        storey: { id: "storey", name: "Tang 3", type: "IfcBuildingStorey" },
      },
    },
    scene: { objects: {} },
  };
}

test("quick BIM properties expose IFC identity and standard Pset values", () => {
  const snapshot = buildObjectPropertiesSnapshot(createViewer(), ["model-a#wall-1"], "single", "vi", FULL_ACCESS);
  assert.equal(snapshot.count, 1);
  assert.ok(snapshot.identityRows.some((row) => row.label === "Loại IFC" && row.value === "IfcWall"));
  assert.ok(snapshot.identityRows.some((row) => row.label === "Tầng" && row.value === "Tang 3"));
  assert.ok(snapshot.propertyRows.some((row) => row.label === "Fire Rating" && row.value === "EI60"));
});

test("group properties include only values shared by the selected sample", () => {
  const snapshot = buildObjectPropertiesSnapshot(
    createViewer(),
    ["model-a#wall-1", "model-a#wall-2", "model-a#wall-3"],
    "type",
    "vi",
    FULL_ACCESS,
  );
  assert.ok(snapshot.propertyRows.some((row) => row.label === "Reference" && row.value === "W-200"));
  assert.ok(!snapshot.propertyRows.some((row) => row.label === "Fire Rating"));
});

test("matching ignores business fields and separates technical differences", () => {
  const viewer = createViewer();
  assert.equal(
    resolveTechnicalMatchValue(viewer, "model-a#wall-1", "exact"),
    resolveTechnicalMatchValue(viewer, "model-a#wall-2", "exact"),
  );
  assert.notEqual(
    resolveTechnicalMatchValue(viewer, "model-a#wall-1", "exact"),
    resolveTechnicalMatchValue(viewer, "model-a#wall-3", "exact"),
  );
  const snapshot = buildObjectPropertiesSnapshot(viewer, ["model-a#wall-1"], "single", "vi", FULL_ACCESS);
  assert.ok(!snapshot.propertyRows.some((row) => row.label === "Internal Cost"));
  assert.ok(!snapshot.propertyRows.some((row) => row.label === "Zone"));
});

test("quick property text and access are bounded before rendering", () => {
  const viewer = createViewer();
  viewer.metaScene.metaObjects["model-a#wall-1"].propertySets[0].properties.push({
    name: "Reference",
    value: "X".repeat(400),
  });
  const snapshot = buildObjectPropertiesSnapshot(
    viewer,
    ["model-a#wall-1"],
    "single",
    "vi",
    { ...FULL_ACCESS, propertySets: false, globalId: false },
  );
  assert.equal(snapshot.propertySetsVisible, false);
  assert.deepEqual(snapshot.propertyRows, []);
  assert.ok(!snapshot.identityRows.some((row) => row.label === "GlobalId"));
});

test("identical matching fails closed when canonical metadata exceeds its budget", () => {
  const viewer = createViewer();
  viewer.metaScene.metaObjects["model-a#wall-1"].propertySets[0].properties.push({
    name: "Reference",
    value: "X".repeat(600),
  });
  assert.equal(resolveTechnicalMatchValue(viewer, "model-a#wall-1", "exact"), "");
});
