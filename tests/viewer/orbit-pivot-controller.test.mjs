import test from "node:test";
import assert from "node:assert/strict";
import { createOrbitPivotController } from "../../packages/viewer/src/xeokit/orbit-pivot.js";

function createTimerTarget() {
  const callbacks = new Map();
  let nextId = 1;
  return {
    clearTimeout(id) { callbacks.delete(id); },
    setTimeout(callback, delay) {
      const id = nextId++;
      callbacks.set(id, { callback, delay });
      return id;
    },
    runNext() {
      const [id, timer] = callbacks.entries().next().value || [];
      if (!timer) return;
      callbacks.delete(id);
      timer.callback();
      return timer.delay;
    },
  };
}

test("orbit pivot uses the picked surface locally and briefly marks the point", () => {
  const timerTarget = createTimerTarget();
  const canvas = {
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
  };
  const marker = { hidden: true, style: {} };
  const viewer = {
    cameraControl: { navMode: "orbit", followPointer: false, smartPivot: true },
    scene: {
      canvas: { canvas },
      pick: (options) => {
        assert.deepEqual(options, { canvasPos: [100, 50], pickSurface: true });
        return { worldPos: [12, 3, -8] };
      },
    },
  };
  const controller = createOrbitPivotController(viewer, { marker, timerTarget });

  assert.equal(controller.setFromPointerEvent({ clientX: 110, clientY: 70 }), false);
  assert.equal(controller.setEnabled(true), true);
  assert.equal(controller.setFromPointerEvent({ clientX: 110, clientY: 70 }), true);
  assert.deepEqual(viewer.cameraControl.pivotPos, [12, 3, -8]);
  assert.equal(viewer.cameraControl.followPointer, true);
  assert.equal(viewer.cameraControl.smartPivot, false);
  assert.deepEqual(marker.style, { left: '100px', top: '50px' });
  assert.equal(marker.hidden, false);
  assert.equal(timerTarget.runNext(), 1400);
  assert.equal(marker.hidden, true);
  assert.equal(controller.setEnabled(false), false);
  assert.equal(controller.setFromPointerEvent({ clientX: 110, clientY: 70 }), false);
  controller.destroy();
});
test("orbit pivot stays inactive in walk and fly modes", () => {
  const viewer = {
    cameraControl: { navMode: "firstPerson" },
    scene: { canvas: { canvas: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } } },
  };
  const controller = createOrbitPivotController(viewer, { timerTarget: createTimerTarget() });

  controller.setEnabled(true);
  assert.equal(controller.setFromPointerEvent({ clientX: 1, clientY: 1 }), false);
  assert.equal(viewer.cameraControl.pivotPos, undefined);
  controller.destroy();
});
