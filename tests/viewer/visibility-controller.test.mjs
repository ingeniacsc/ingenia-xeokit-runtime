import test from "node:test";
import assert from "node:assert/strict";
import { createVisibilityController } from "../../packages/viewer/src/xeokit/visibility.js";

function createViewer() {
  const listeners = new Map();
  const objects = {
    wall: { id: "wall", visible: true },
    pipe: { id: "pipe", visible: true },
  };
  const scene = {
    objects,
    objectIds: Object.keys(objects),
    on: (name, callback) => { listeners.set(name, callback); return name; },
    off: (name) => listeners.delete(name),
    render: () => {},
    setObjectsVisible(ids, visible) {
      ids.forEach((id) => {
        if (!objects[id]) return;
        objects[id].visible = visible;
        listeners.get("objectVisibility")?.(objects[id]);
      });
    },
  };
  return { viewer: { scene }, objects, listeners };
}

test("tree visibility remains hidden after appearance reapplication", () => {
  const { viewer, objects, listeners } = createViewer();
  const visibility = createVisibilityController(viewer);

  objects.wall.visible = false;
  listeners.get("objectVisibility")(objects.wall);
  objects.wall.visible = true;
  visibility.reapply();

  assert.equal(objects.wall.visible, false);
  assert.deepEqual(visibility.hiddenObjectIds(), ["wall"]);
});

test("visibility reset clears manual hidden state", () => {
  const { viewer, objects, listeners } = createViewer();
  const visibility = createVisibilityController(viewer);
  objects.pipe.visible = false;
  listeners.get("objectVisibility")(objects.pipe);

  visibility.reset();

  assert.equal(objects.pipe.visible, true);
  assert.deepEqual(visibility.hiddenObjectIds(), []);
  visibility.destroy();
  assert.equal(listeners.size, 0);
});

test("show, transient restore, and reset never reveal geometry outside the capability scope", () => {
  const { viewer, objects } = createViewer();
  const visibility = createVisibilityController(viewer, { isObjectAllowed: (id) => id !== "pipe" });

  visibility.hideTransient(["wall", "pipe"]);
  visibility.restoreTransient(["wall", "pipe"]);
  assert.equal(objects.wall.visible, true);
  assert.equal(objects.pipe.visible, false);

  visibility.show(["pipe"]);
  assert.equal(objects.pipe.visible, false);

  visibility.reset();
  assert.equal(objects.wall.visible, true);
  assert.equal(objects.pipe.visible, false);
  assert.deepEqual(visibility.hiddenObjectIds(), []);
});
