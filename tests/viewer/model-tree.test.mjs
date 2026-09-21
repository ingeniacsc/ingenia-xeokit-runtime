import test from "node:test";
import assert from "node:assert/strict";
import { MODEL_TREE_TABS } from "../../packages/viewer/src/xeokit/tree.js";

test("model tree mirrors the direct Xeokit four-view explorer", () => {
  assert.deepEqual(MODEL_TREE_TABS.map(({ id, hierarchy }) => ({ id, hierarchy })), [
    { id: "models", hierarchy: "containment" },
    { id: "containment", hierarchy: "containment" },
    { id: "types", hierarchy: "types" },
    { id: "storeys", hierarchy: "storeys" },
  ]);
});

test("model tree accepts bounded display names for model roots", async () => {
  const source = await import("../../packages/viewer/src/xeokit/tree.js");
  const treeSource = await (await import("node:fs/promises")).readFile(
    new URL("../../packages/viewer/src/xeokit/tree.js", import.meta.url),
    "utf8",
  );
  const hierarchySource = await (await import("node:fs/promises")).readFile(
    new URL("../../packages/viewer/src/xeokit/tree-hierarchy.js", import.meta.url),
    "utf8",
  );
  assert.match(hierarchySource, /rootName: displayName \|\| modelId/);
  assert.match(hierarchySource, /metaModel\?\.finalized/);
  assert.match(treeSource, /modelLoadedSubscription/);
  assert.match(treeSource, /metaModelCreatedSubscription/);
  assert.match(treeSource, /autoAddModels: false/);
  assert.match(treeSource, /createTreeSearchPlan/);
  assert.match(treeSource, /searchInput\.addEventListener\("input"/);
  assert.match(treeSource, /onOpenChange\?\.\(false\)/);
  assert.match(treeSource, /onOpenChange\?\.\(open\)/);
  assert.match(treeSource, /resolveSingleModelTreeSelection/);
  assert.match(treeSource, /decorateModelTreeBody/);
  assert.doesNotMatch(treeSource, /addEventListener\("change", checkboxHandler\)/);
  assert.doesNotMatch(treeSource, /model\.catalog/);
  assert.doesNotMatch(treeSource, /onCatalogAction/);
  assert.equal(source.MODEL_TREE_TABS.length, 4);
});

test("storeys hierarchy admits valid federation models independently", async () => {
  const { populateModelTree } = await import(
    "../../packages/viewer/src/xeokit/tree-hierarchy.js"
  );
  const valid = {
    finalized: true,
    rootMetaObjects: [{ type: "IfcBuilding", children: [{ type: "IfcBuildingStorey" }] }],
  };
  const invalid = { finalized: true, rootMetaObjects: [{ type: "IfcBuildingStorey" }] };
  const added = [];
  populateModelTree({
    viewer: { metaScene: { metaModels: { valid, invalid } } },
    plugin: { addModel: (modelId) => added.push(modelId) },
    modelEntries: [{ modelId: "valid" }, { modelId: "invalid" }],
    hierarchy: "storeys",
    body: { appendChild() {} },
  });
  assert.deepEqual(added, ["valid"]);
});

test("storeys hierarchy fails soft when IFC building metadata is unavailable", async () => {
  const { supportsModelTreeHierarchy } = await import(
    "../../packages/viewer/src/xeokit/tree-hierarchy.js"
  );
  const withoutBuilding = {
    rootMetaObjects: [{ type: "IfcBuildingStorey" }],
  };
  const withBuilding = {
    rootMetaObjects: [{
      type: "IfcProject",
      children: [{
        type: "IfcBuilding",
        children: [{ type: "IfcBuildingStorey" }],
      }],
    }],
  };
  const orphanStorey = {
    rootMetaObjects: [
      { type: "IfcBuilding" },
      { type: "IfcBuildingStorey" },
    ],
  };

  assert.equal(supportsModelTreeHierarchy(withoutBuilding, "storeys"), false);
  assert.equal(supportsModelTreeHierarchy(withBuilding, "storeys"), true);
  assert.equal(supportsModelTreeHierarchy(orphanStorey, "storeys"), false);
  assert.equal(supportsModelTreeHierarchy(withoutBuilding, "containment"), true);
});

test("tree search is accent-insensitive, bounded, and keeps ancestors visible", async () => {
  const { createTreeSearchPlan, normalizeTreeSearchText } = await import(
    "../../packages/viewer/src/xeokit/tree-search.js"
  );
  const root = { nodeId: "root", title: "Mô hình", parent: null };
  const floor = { nodeId: "floor", title: "Tầng 3", parent: root };
  const object = { nodeId: "object", title: "Ống điều hòa", parent: floor };
  const plugin = { _nodeNodes: { root, floor, object } };
  const plan = createTreeSearchPlan(plugin, "dieu hoa", 10);

  assert.equal(normalizeTreeSearchText("Điều Hòa"), "dieu hoa");
  assert.deepEqual(plan.matchedNodeIds, ["object"]);
  assert.deepEqual([...plan.visibleNodeIds], ["object", "floor", "root"]);
  assert.equal(plan.totalMatches, 1);
  assert.equal(plan.limited, false);
});

test("model loading supports verified MetaModel data for tree hierarchies", async () => {
  const modelSource = await (await import("node:fs/promises")).readFile(
    new URL("../../packages/viewer/src/xeokit/model.js", import.meta.url),
    "utf8",
  );
  assert.match(modelSource, /metaModelUrl/);
  assert.match(modelSource, /metaModelRequestHeaders/);
  assert.match(modelSource, /metaModelContentHash/);
  assert.match(modelSource, /metaModelData/);
});
