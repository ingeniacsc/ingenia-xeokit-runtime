import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAxisRangePreview, axisRangeScenePoint } from '../../packages/viewer/src/xeokit/axis-range-preview-geometry.js';
const bounds = { x: [-2, 8], y: [3, 15], z: [20, 50] };
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const kept = (point, planes) => planes.every(({ pos, dir }) =>
  dot(dir, point.map((value, index) => value - pos[index])) >= -1e-8);

test('engineering XYZ corners and face labels keep elevation on scene Y and north on negative Z', () => {
  const result = buildAxisRangePreview({ bounds });
  assert.equal(result.corners.length, 8);
  assert.deepEqual(result.corners[0], [-2, 20, -3]);
  assert.deepEqual(result.corners[7], [8, 50, -15]);
  assert.deepEqual(result.planes.map(({ axis, side, value }) => [axis, side, value]),
    [['x', 0, -2], ['x', 1, 8], ['y', 0, 3], ['y', 1, 15], ['z', 0, 20], ['z', 1, 50]]);
  assert.deepEqual(result.planes.map(({ dir }) => dir),
    [[1, 0, 0], [-1, 0, 0], [0, 0, -1], [0, 0, 1], [0, 1, 0], [0, -1, 0]]);
});

test('six inward planes retain the complete box, reject each exterior side for unrotated and rotated grids', () => {
  for (const frame of [undefined, { origin: [132, -23], x: [0.6, 0.8], y: [-0.8, 0.6] },
    { origin: [100, 200], x: [0, 1], y: [1, 0] }]) {
    const result = buildAxisRangePreview({ bounds, frame });
    const toScene = (point) => axisRangeScenePoint(point, result.range.frame);
    assert.equal(kept(toScene([3, 9, 35]), result.planes), true);
    result.corners.forEach((point) => assert.equal(kept(point, result.planes), true));
    for (const outside of [[-2.01, 9, 35], [8.01, 9, 35], [3, 2.99, 35], [3, 15.01, 35],
      [3, 9, 19.99], [3, 9, 50.01]]) assert.equal(kept(toScene(outside), result.planes), false);
    result.planes.forEach(({ dir }) => assert.ok(Math.abs(dot(dir, dir) - 1) < 1e-10));
  }
});

test('wire aid has twelve distinct edges grouped by engineering axis with constant vertex counts', () => {
  const result = buildAxisRangePreview({ bounds });
  const edges = new Set();
  for (const wire of result.wires) {
    assert.equal(wire.positions.length, 24);
    assert.equal(wire.indices.length, 8);
    for (let i = 0; i < 24; i += 6) edges.add(JSON.stringify(wire.positions.slice(i, i + 6)));
  }
  assert.equal(edges.size, 12);
  const changed = buildAxisRangePreview({ bounds: { ...bounds, z: [24, 32] } });
  assert.deepEqual(changed.planes.slice(4).map((plane) => plane.pos[1]), [24, 32]);
  assert.deepEqual(changed.wires.map((wire) => wire.positions.length), [24, 24, 24]);
});

test('invalid coordinates/frame fail before resources are created; source bounds remain unmodified', () => {
  const before = structuredClone(bounds);
  const result = buildAxisRangePreview({ bounds });
  result.range.bounds.x[0] = 42;
  assert.deepEqual(bounds, before);
  for (const invalid of [{ bounds: { ...bounds, z: [20, 20] } },
    { bounds: { ...bounds, x: [NaN, 8] } }, { bounds, frame: { origin: [0, 0], x: [1, 0], y: [1, 1] } }]) {
    assert.throws(() => buildAxisRangePreview(invalid), /invalid_/);
  }
});

// Exercise the real controller with only SDK constructors replaced. The browser gate
// separately checks actual xeokit rendering; this covers ownership and idle scheduling.
import { readFile } from 'node:fs/promises';
async function controllerFixture() {
  const made = [], frames = new Map(); let nextFrame = 0;
  const type = (kind) => class {
    constructor(scene, config) { Object.assign(this, config); this.kind = kind; this.destroyed = false; made.push(this); }
    destroy() { assert.equal(this.destroyed, false); this.destroyed = true; }
  };
  globalThis.__axisPreviewTestTypes = { Mesh: type('mesh'), PhongMaterial: type('material'),
    ReadableGeometry: type('geometry'), SectionPlane: type('plane') };
  const source = (await readFile(new URL('../../packages/viewer/src/xeokit/axis-range-preview.js', import.meta.url), 'utf8'))
    .replace('import { Mesh, PhongMaterial, ReadableGeometry, SectionPlane } from "@xeokit/xeokit-sdk";',
      'const { Mesh, PhongMaterial, ReadableGeometry, SectionPlane } = globalThis.__axisPreviewTestTypes;')
    .replace('"./axis-range-preview-geometry.js"', JSON.stringify(new URL('../../packages/viewer/src/xeokit/axis-range-preview-geometry.js', import.meta.url).href));
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Math.random()}`);
  delete globalThis.__axisPreviewTestTypes;
  const emitter = () => {
    const events = new Map(); return { events, on(event, callback) { events.set(event, callback); return event; },
      off(event) { events.delete(event); }, emit(event) { events.get(event)?.(); } };
  };
  const document = { defaultView: { requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); } } };
  document.createElement = () => ({ style: {}, dataset: {}, children: [], ownerDocument: document,
    setAttribute() {}, appendChild(node) { this.children.push(node); node.parent = this; },
    remove() { this.parent.children = this.parent.children.filter((node) => node !== this); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; } });
  const container = document.createElement();
  const camera = { ...emitter(), eye: [0, 100, 0], look: [0, 0, 0], projectWorldPos: () => [200, 200] };
  const objects = { original: { visible: true, selected: true } }, otherPlane = { active: true };
  const viewer = { camera, scene: { objects, sectionPlanes: { original: otherPlane }, canvas: { ...emitter(), canvas: container } } };
  const controller = module.createAxisRangePreview(viewer, { container, locale: 'en' });
  return { controller, made, frames, container, camera, viewer, otherPlane,
    flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback()); } };
}

test('scene preview reuses resources across drag updates and performs no idle animation loop', async () => {
  const f = await controllerFixture();
  f.controller.update({ bounds }); f.flush();
  assert.equal(f.frames.size, 0);
  assert.equal(f.made.filter((item) => item.kind === 'plane').length, 6);
  assert.equal(f.made.filter((item) => item.kind === 'mesh').length, 3);
  const count = f.made.length;
  for (let z = 21; z <= 30; z++) f.controller.update({ bounds: { ...bounds, z: [z, 50] } });
  assert.equal(f.made.length, count);
  assert.equal(f.frames.size, 1); f.flush(); assert.equal(f.frames.size, 0);
  f.camera.emit('viewMatrix'); f.camera.emit('projMatrix');
  assert.equal(f.frames.size, 1); f.flush(); assert.equal(f.frames.size, 0);
  assert.deepEqual(f.container.children[0].children.map((label) => label.dataset.axisRangeFace),
    ['x-min', 'x-max', 'y-min', 'y-max', 'z-min', 'z-max']);
  assert.equal(f.container.children[0].children[4].textContent, 'Z Min = 30.000 m');
  f.controller.destroy();
});

test('clear disposes only owned aids and subscriptions, preserving models and other section planes', async () => {
  const f = await controllerFixture(); f.controller.update({ bounds });
  for (const mesh of f.made.filter((item) => item.kind === 'mesh')) {
    for (const key of ['isObject', 'pickable', 'collidable', 'clippable']) assert.equal(mesh[key], false);
  }
  f.controller.clear();
  assert.equal(f.frames.size, 0); assert.equal(f.camera.events.size, 0);
  assert.equal(f.viewer.scene.canvas.events.size, 0); assert.equal(f.container.children.length, 0);
  assert.ok(f.made.every((item) => item.destroyed));
  assert.deepEqual(f.viewer.scene.objects, { original: { visible: true, selected: true } });
  assert.equal(f.viewer.scene.sectionPlanes.original, f.otherPlane);
  f.controller.update({ bounds }); assert.equal(f.made.length, 30);
  f.controller.destroy(); f.controller.destroy();
  f.controller.update({ bounds }); assert.equal(f.made.length, 30);
});

test('invalid edits remove stale clipping instead of retaining an incorrect preview', async () => {
  const f = await controllerFixture(); f.controller.update({ bounds });
  assert.throws(() => f.controller.update({ bounds: { ...bounds, z: [50, 20] } }), /invalid_bounds/);
  assert.ok(f.made.every((item) => item.destroyed));
  assert.equal(f.container.children.length, 0); assert.equal(f.frames.size, 0);
  f.controller.destroy();
});
