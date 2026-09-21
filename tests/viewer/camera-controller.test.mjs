import test from "node:test";
import assert from "node:assert/strict";
import { createCameraController } from "../../packages/viewer/src/xeokit/camera.js";

function createViewer() {
  const calls = [];
  const viewer = {
    camera: { projection: "perspective" },
    cameraControl: {},
    cameraFlight: {
      flyTo: (payload) => calls.push(payload),
      stop: () => calls.push({ stopped: true }),
    },
    scene: {
      getAABB: (identifiers) => new Float64Array(identifiers?.length
        ? [1, 2, 3, 3, 6, 9]
        : [10, 20, 30, 30, 50, 70]),
      render: () => calls.push({ rendered: true }),
    },
  };
  return { calls, viewer };
}

test("camera fit and views use the loaded model bounds", () => {
  const { calls, viewer } = createViewer();
  const camera = createCameraController(viewer);

  camera.fit(["object-a"]);
  assert.deepEqual(calls.shift(), { aabb: [1, 2, 3, 3, 6, 9], duration: 0.6 });

  camera.view("front");
  const front = calls.shift();
  assert.deepEqual(front.look, [20, 35, 50]);
  assert.deepEqual(front.up, [0, 1, 0]);
  assert.equal(front.projection, "ortho");
  assert.ok(front.eye[2] > front.look[2]);

  camera.view("iso");
  const iso = calls.shift();
  assert.deepEqual(iso, {
    aabb: [10, 20, 30, 30, 50, 70],
    duration: 0.6,
  });
  assert.deepEqual(viewer.camera.look, [20, 35, 50]);
  assert.deepEqual(viewer.camera.up, [0, 1, 0]);
  assert.equal(viewer.camera.projection, "perspective");
  assert.deepEqual(viewer.cameraControl.pivotPos, viewer.camera.look);
  const isoOffset = viewer.camera.eye.map((value, index) => value - viewer.camera.look[index]);
  assert.ok(isoOffset[0] > 0);
  assert.ok(isoOffset[1] > 0);
  assert.ok(isoOffset[2] > 0);
  assert.ok(isoOffset[1] < isoOffset[0]);
  assert.ok(Math.abs((isoOffset[1] / isoOffset[0]) - 0.4) < 1e-9);
  assert.ok(Math.abs(Math.hypot(...isoOffset) - getExpectedCameraDistance()) < 1e-9);
});

function getExpectedCameraDistance() {
  return Math.hypot(20, 30, 40) * 1.35;
}

test("orthographic presets fit both viewport dimensions with padding", () => {
  for (const [width, height] of [[390, 844], [1280, 800], [800, 800]]) {
    for (const [view, spanX, spanY] of [
      ["top", 20, 40], ["bottom", 20, 40],
      ["front", 20, 30], ["back", 20, 30],
      ["left", 40, 30], ["right", 40, 30],
    ]) {
      const {viewer, calls} = createViewer();
      viewer.scene.canvas = {boundary: [0, 0, width, height]};
      createCameraController(viewer).view(view);
      const {orthoScale} = calls[0];
      const aspect = width / height;
      assert.ok(orthoScale * Math.min(aspect, 1) >= spanX * 1.14, view);
      assert.ok(orthoScale / Math.max(aspect, 1) >= spanY * 1.14, view);
    }
  }
});

test("orthographic presets tolerate unavailable canvas dimensions", () => {
  for (const boundary of [undefined, [0, 0, 0, 0], [0, 0, 390, 0]]) {
    const {viewer, calls} = createViewer();
    viewer.scene.canvas = {boundary};
    createCameraController(viewer).view("top");
    assert.ok(Number.isFinite(calls[0].orthoScale));
    assert.ok(calls[0].orthoScale > 40);
  }
});

test("walk and fly retain the direct viewer navigation semantics", () => {
  const { calls, viewer } = createViewer();
  const camera = createCameraController(viewer);

  camera.navigation("walk");
  assert.equal(viewer.camera.projection, "perspective");
  assert.equal(viewer.cameraControl.navMode, "firstPerson");
  assert.equal(viewer.cameraControl.constrainVertical, true);
  assert.equal(viewer.cameraControl.keyboardPanRate, 4);
  assert.equal(viewer.cameraControl.keyboardDollyRate, 8);

  camera.navigation("fly");
  assert.equal(viewer.cameraControl.constrainVertical, false);
  assert.equal(viewer.cameraControl.keyboardPanRate, 12);
  assert.equal(viewer.cameraControl.keyboardDollyRate, 28);
  assert.equal(calls.filter((item) => item.rendered).length, 2);
});
