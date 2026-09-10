import test from "node:test";
import assert from "node:assert/strict";
import { createAppearanceController } from "../../packages/viewer/src/xeokit/appearance.js";

function createViewer() {
  const calls = [];
  const wall = { id: "wall-1" };
  const pipe = { id: "pipe-1" };
  return {
    calls,
    viewer: {
      metaScene: {
        metaObjects: {
          "wall-1": { type: "IfcWall" },
          "pipe-1": { type: "IfcPipeSegment" },
        },
      },
      scene: {
        colorizedObjectIds: [],
        opacityObjectIds: [],
        objects: { "wall-1": wall, "pipe-1": pipe },
        render: () => calls.push("render"),
        setObjectsColorized: () => calls.push("colorized"),
        setObjectsOpacity: () => calls.push("opacity"),
      },
    },
    wall,
    pipe,
  };
}

test("IFC color mode matches the approved direct-viewer palette behavior", () => {
  const { calls, pipe, viewer, wall } = createViewer();
  const appearance = createAppearanceController(viewer);

  appearance.apply({ options: { mode: "ifc" } });
  assert.deepEqual(wall.colorize, [0.90, 0.87, 0.80]);
  assert.deepEqual(pipe.colorize, [0.20, 0.55, 0.80]);
  assert.deepEqual(calls, ["render"]);

  appearance.apply({ options: { mode: "source" } });
  assert.equal(wall.colorize, null);
  assert.equal(pipe.colorize, null);
});

test("discipline color mode overlays every object in the approved model palette", () => {
  const { pipe, viewer, wall } = createViewer();
  viewer.scene.objects = {
    "model.123456789012#GUID-WALL": wall,
    "model.123456789012#GUID-PIPE": pipe,
  };
  wall.id = "model.123456789012#GUID-WALL";
  pipe.id = "model.123456789012#GUID-PIPE";
  const appearance = createAppearanceController(viewer, {
    model: {
      disciplineColorFor: (objectId) => objectId.startsWith("model.123456789012#") ? "#DC2626" : "",
    },
  });

  appearance.apply({ options: { mode: "discipline" } });
  assert.deepEqual(wall.colorize, [220 / 255, 38 / 255, 38 / 255]);
  assert.deepEqual(pipe.colorize, [220 / 255, 38 / 255, 38 / 255]);
  assert.equal(appearance.state().colorMode, "discipline");

  appearance.apply({ options: { mode: "source" } });
  assert.equal(wall.colorize, null);
  assert.equal(pipe.colorize, null);
});

test("spaces and glass keep their semantic transparency in every presentation mode", () => {
  const { viewer } = createViewer();
  const space = { id: "model.123456789012#GUID-SPACE" };
  const glassDoor = { id: "model.123456789012#GUID-GLASS-DOOR" };
  const window = { id: "model.123456789012#GUID-WINDOW" };
  const pipe = { id: "model.123456789012#GUID-PIPE" };
  viewer.scene.objects = {
    [space.id]: space,
    [glassDoor.id]: glassDoor,
    [window.id]: window,
    [pipe.id]: pipe,
  };
  Object.assign(viewer.metaScene.metaObjects, {
    [space.id]: { type: "IfcSpace" },
    [glassDoor.id]: {
      type: "IfcDoor",
      propertySets: [{
        name: "Pset_DoorCommon",
        properties: [{ name: "Vat lieu", value: "Tempered Glass" }],
      }],
    },
    [window.id]: { type: "IfcWindow" },
    [pipe.id]: { type: "IfcPipeSegment" },
  });
  const appearance = createAppearanceController(viewer, {
    model: { disciplineColorFor: () => "#1D4ED8" },
  });

  appearance.apply({ options: { mode: "discipline" } });

  assert.equal(space.opacity, 0.12);
  assert.equal(glassDoor.opacity, 0.36);
  assert.equal(window.opacity, 0.36);
  assert.equal(pipe.opacity, 1);
  assert.deepEqual(glassDoor.colorize, [29 / 255, 78 / 255, 216 / 255]);

  appearance.apply({ options: { mode: "ifc" } });
  assert.equal(space.opacity, 0.12);
  assert.equal(glassDoor.opacity, 0.36);
});

test("selected opaque objects become see-through and restore their presentation opacity", () => {
  const { viewer, wall } = createViewer();
  wall.selected = true;
  const appearance = createAppearanceController(viewer);

  appearance.apply({ options: { mode: "source" } });
  assert.equal(wall.opacity, 0.35);

  wall.selected = false;
  appearance.reapply();
  assert.equal(wall.opacity, 1);
});

test("manual opacity preserves the requested value for unselected objects", () => {
  const { viewer } = createViewer();
  const opacityCalls = [];
  viewer.scene.setObjectsOpacity = (identifiers, opacity) => opacityCalls.push([identifiers, opacity]);
  const appearance = createAppearanceController(viewer);

  appearance.apply({
    identifiers: ["wall-1", "pipe-1"],
    options: { opacity: 0.8 },
  });

  assert.deepEqual(opacityCalls, [[["wall-1", "pipe-1"], 0.8]]);
});

test("manual opacity keeps selected objects see-through without changing their peers", () => {
  const { viewer, wall } = createViewer();
  const opacityCalls = [];
  wall.selected = true;
  viewer.scene.setObjectsOpacity = (identifiers, opacity) => opacityCalls.push([identifiers, opacity]);
  const appearance = createAppearanceController(viewer);

  appearance.apply({
    identifiers: ["wall-1", "pipe-1"],
    options: { opacity: 0.8 },
  });

  assert.deepEqual(opacityCalls, [
    [["wall-1", "pipe-1"], 0.8],
    [["wall-1"], 0.35],
  ]);
});

test("space transparency survives a business status filter reset", () => {
  const { viewer } = createViewer();
  const space = { id: "model.123456789012#GUID-SPACE" };
  viewer.scene.objects = { [space.id]: space };
  viewer.metaScene.metaObjects[space.id] = { type: "IfcSpace" };
  const appearance = createAppearanceController(viewer);

  appearance.apply({ options: { mode: "business" } });
  appearance.apply({ options: { businessStatusFilter: [] } });

  assert.equal(space.opacity, 0.12);
});

test("native IFC/XKT opacity takes precedence over semantic transparency fallbacks", () => {
  const { viewer } = createViewer();
  const space = { id: "model.123456789012#GUID-SPACE", opacity: 0.58 };
  const glassDoor = { id: "model.123456789012#GUID-GLASS-DOOR", opacity: 0.52 };
  viewer.scene.objects = { [space.id]: space, [glassDoor.id]: glassDoor };
  Object.assign(viewer.metaScene.metaObjects, {
    [space.id]: { type: "IfcSpace" },
    [glassDoor.id]: {
      type: "IfcDoor",
      propertySets: [{ name: "Pset_GlassDoorCommon", properties: [] }],
    },
  });
  const appearance = createAppearanceController(viewer, {
    model: { disciplineColorFor: () => "#1D4ED8" },
  });

  appearance.apply({ options: { mode: "discipline" } });
  assert.equal(space.opacity, 0.58);
  assert.equal(glassDoor.opacity, 0.52);

  appearance.apply({ options: { mode: "business" } });
  assert.equal(space.opacity, 0.58);
  assert.equal(glassDoor.opacity, 0.52);
});

test("business colors target one federated model without exposing dossier data", () => {
  const { viewer, wall } = createViewer();
  viewer.scene.objects = {
    "model.123456789012#GUID-WALL": wall,
    "model.123456789012#GUID-PIPE": { id: "model.123456789012#GUID-PIPE" },
  };
  const appearance = createAppearanceController(viewer);

  appearance.apply({ options: { mode: "business" } });
  appearance.apply({
    options: {
      replaceBusinessStatuses: true,
      businessStatuses: [{
        modelId: "model.123456789012",
        globalId: "GUID-WALL",
        color: "#C62828",
        status: "REWORK_REQUIRED",
        emphasize: true,
        etdl: { value: "must be ignored" },
      }],
    },
  });

  assert.deepEqual(wall.colorize, [198 / 255, 40 / 255, 40 / 255]);
  assert.equal(wall.highlighted, true);
  assert.equal(viewer.scene.objects["model.123456789012#GUID-PIPE"].colorize, null);
});

test("business status filter dims non-matching objects and clears cleanly", () => {
  const { viewer } = createViewer();
  const wall = { id: "model.123456789012#GUID-WALL" };
  const pipe = { id: "model.123456789012#GUID-PIPE" };
  wall.visible = false;
  pipe.visible = true;
  viewer.scene.objects = { [wall.id]: wall, [pipe.id]: pipe };
  const appearance = createAppearanceController(viewer);

  appearance.apply({ options: { mode: "business" } });
  appearance.apply({
    options: {
      replaceBusinessStatuses: true,
      businessStatuses: [
        { modelId: "model.123456789012", globalId: "GUID-WALL", color: "#1976D2", status: "IN_PROGRESS" },
        { modelId: "model.123456789012", globalId: "GUID-PIPE", color: "#C62828", status: "REWORK_REQUIRED" },
      ],
    },
  });
  appearance.apply({ options: { businessStatusFilter: ["IN_PROGRESS"] } });

  assert.equal(wall.visible, false);
  assert.equal(wall.opacity, 1);
  assert.equal(pipe.visible, true);
  assert.equal(pipe.opacity, 0.08);

  appearance.apply({ options: { businessStatusFilter: [] } });
  assert.equal(wall.opacity, 1);
  assert.equal(pipe.opacity, 1);
});

test("X-Ray preserves objects hidden through the model tree", () => {
  const { viewer, wall, pipe } = createViewer();
  wall.visible = false;
  wall.xrayed = false;
  pipe.visible = false;
  pipe.xrayed = false;
  const appearance = createAppearanceController(viewer);

  appearance.apply({
    identifiers: [wall.id],
    options: { xrayOthers: true },
  });

  assert.equal(wall.visible, false);
  assert.equal(wall.xrayed, false);
  assert.equal(pipe.visible, false);
  assert.equal(pipe.xrayed, true);
});
