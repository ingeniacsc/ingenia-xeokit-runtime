import test from 'node:test';
import assert from 'node:assert/strict';
import { createCameraController } from '../../packages/viewer/src/xeokit/camera.js';

test('admin direction is fitted to current federation without moving model geometry', () => {
  const bounds = [0, 0, 0, 20, 40, 60], jumps = [];
  const camera = { eye: [0, 0, 100], look: [0, 0, 0], up: [0, 1, 0], projection: 'perspective' };
  const viewer = { camera, cameraControl: {}, scene: { getAABB: () => bounds, render() {} }, cameraFlight: { stop() {}, jumpTo: (v) => jumps.push(v) } };
  const controller = createCameraController(viewer);
  controller.set({ initialView: { direction: [-1, 0.4, 1], up: [0, 1, 0], projection: 'ortho' } });
  assert.deepEqual(camera.look, [10, 20, 30]);
  assert.ok(camera.eye[0] < camera.look[0]);
  assert.ok(camera.eye[2] > camera.look[2]);
  assert.equal(camera.projection, 'ortho');
  assert.deepEqual(jumps[0].aabb, bounds);
  assert.equal(controller.get().projection, 'ortho');
  assert.ok(Math.abs(Math.hypot(...controller.get().direction) - 1) < 1e-9);
  const before = structuredClone(camera);
  assert.throws(() => controller.set({ initialView: { direction: [NaN, 0, 1], up: [0, 1, 0], projection: 'ortho' } }));
  assert.throws(() => controller.set({ initialView: { direction: [0, 1, 0], up: [0, 1, 0], projection: 'ortho' } }));
  assert.deepEqual(camera, before);
});
