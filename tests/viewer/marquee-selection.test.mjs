// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarqueeIntersection } from '../../packages/viewer/src/xeokit/marquee-selection.js';
import { createSelectionController } from '../../packages/viewer/src/xeokit/selection.js';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const bounds = { left: 120, top: 80, width: 200, height: 100 };
const rectangle = { left: 50, top: 25, right: 150, bottom: 75 };
function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn, capture = false) {
      const current = listeners.get(type) || [];
      current.push({ fn, capture });
      listeners.set(type, current);
    },
    removeEventListener(type, fn) {
      listeners.set(type, (listeners.get(type) || []).filter((entry) => entry.fn !== fn));
    },
    emit(type, props = {}) {
      const event = { pointerId: 1, pointerType: 'mouse', button: 0, ctrlKey: true,
        clientX: 170, clientY: 105, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }, ...props };
      [...(listeners.get(type) || [])].sort((a, b) => Number(b.capture) - Number(a.capture))
        .forEach(({ fn }) => fn(event));
      return event;
    },
    count() { return [...listeners.values()].reduce((count, entries) => count + entries.length, 0); },
  };
}
function fixture(options = {}) {
  const canvas = eventTarget();
  const keyboardTarget = eventTarget();
  const overlays = new Set();
  let captured = null;
  Object.assign(canvas, {
    style: { cursor: 'grab' },
    getBoundingClientRect: () => bounds,
    setPointerCapture: (id) => { captured = id; },
    hasPointerCapture: (id) => captured === id,
    releasePointerCapture: () => { captured = null; },
    ownerDocument: {
      body: { appendChild: (node) => overlays.add(node) },
      createElement: () => {
        const node = { style: {}, setAttribute() {}, remove: () => overlays.delete(node) };
        return node;
      },
    },
  });
  const selected = new Set();
  const objects = {
    'a#pile1': { id: 'a#pile1', visible: true, aabb: [-0.2, -0.2, -0.2, -0.19, 0.2, 0.2] },
    'a#pile2': { id: 'a#pile2', visible: true, aabb: [0.2, -0.2, -0.2, 0.21, 0.2, 0.2] },
    'b#pile1': { id: 'b#pile1', visible: true, aabb: [-0.1, -0.2, -0.2, -0.09, 0.2, 0.2] },
  };
  let pickedId = '';
  const viewer = { cameraControl: { pointerEnabled: true }, scene: {
    camera: { viewMatrix: identity, projMatrix: identity }, canvas: { canvas }, objects,
    pick: () => ({ entity: { id: pickedId } }),
    get selectedObjectIds() { return [...selected]; },
    setObjectsSelected(ids, value) { ids.forEach((id) => value ? selected.add(id) : selected.delete(id)); },
  } };
  const publications = [];
  const completed = [];
  const controller = createSelectionController(viewer, (payload) => publications.push(payload), null, {
    keyboardTarget, onSelectionOperationComplete: (payload) => completed.push(payload), ...options,
  });
  return { viewer, canvas, keyboardTarget, overlays, publications, completed, controller,
    setPicked(id) { pickedId = id; },
    drag() {
      canvas.emit('pointerdown');
      canvas.emit('pointermove', { clientX: 270, clientY: 155 });
      canvas.emit('pointerup', { clientX: 270, clientY: 155 });
    },
  };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

test('active orthographic projection includes thin/crossing bounds and rejects offscreen and clipped bounds', () => {
  const f = fixture();
  f.viewer.scene.sectionPlanes = { cut: { active: true, dir: [0, 0, 1], pos: [0, 0, 0.5] } };
  const hit = createMarqueeIntersection(f.viewer.scene, rectangle);
  const entity = (aabb, overrides = {}) => ({ aabb, ...overrides });
  assert.equal(hit(entity([-0.201, -0.4, -0.1, -0.2, 0.4, 0.1])), true);
  assert.equal(hit(entity([0.49, -0.1, 0, 0.8, 0.1, 0.1])), true);
  assert.equal(hit(entity([0.6, -0.1, 0, 0.8, 0.1, 0.1])), false);
  assert.equal(hit(entity([-0.1, -0.1, 2, 0.1, 0.1, 3])), false);
  assert.equal(hit(entity([-0.1, -0.1, 0.6, 0.1, 0.1, 0.8])), false);
  assert.equal(hit(entity([-0.1, -0.1, 0.6, 0.1, 0.1, 0.8], { clippable: false })), true);
  for (const flags of [{ visible: false }, { pickable: false }, { culled: true }]) {
    assert.equal(hit(entity([-0.1, -0.1, 0, 0.1, 0.1, 0.1], flags)), false);
  }
  assert.equal(hit(entity([NaN, 0, 0, 1, 1, 1])), false);
  f.controller.destroy();
});

test('perspective frustum uses actual near/far planes and translated view matrix', () => {
  const f = fixture();
  f.viewer.scene.camera.projMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -11 / 9, -1, 0, 0, -20 / 9, 0];
  f.viewer.scene.camera.viewMatrix = [...identity];
  f.viewer.scene.camera.viewMatrix[12] = -100;
  const hit = createMarqueeIntersection(f.viewer.scene, rectangle);
  assert.equal(hit({ aabb: [99.9, -0.1, -3, 100.1, 0.1, -2] }), true);
  assert.equal(hit({ aabb: [99.9, -0.1, 2, 100.1, 0.1, 3] }), false);
  assert.equal(hit({ aabb: [99.9, -0.1, -0.5, 100.1, 0.1, -0.1] }), false);
  assert.equal(hit({ aabb: [99.9, -0.1, -12, 100.1, 0.1, -11] }), false);
  f.controller.destroy();
});

test('Ctrl drag immediately suspends camera, shows offset-safe rectangle, selects thin objects and swallows trailing click', async () => {
  const f = fixture();
  f.canvas.emit('pointerdown');
  assert.equal(f.viewer.cameraControl.pointerEnabled, false);
  f.canvas.emit('pointermove', { clientX: 270, clientY: 155 });
  assert.equal(f.overlays.size, 1);
  assert.equal([...f.overlays][0].style.left, '170px');
  assert.equal([...f.overlays][0].style.width, '100px');
  f.canvas.emit('pointerup', { clientX: 270, clientY: 155 });
  assert.equal(f.viewer.cameraControl.pointerEnabled, true);
  assert.equal(f.canvas.style.cursor, 'grab');
  assert.equal(f.overlays.size, 0);
  f.setPicked('b#pile1');
  f.canvas.emit('click', { clientX: 270, clientY: 155 });
  await settle();
  assert.deepEqual(f.viewer.scene.selectedObjectIds, ['a#pile1', 'a#pile2']);
  assert.deepEqual(f.publications, [{ identifiers: ['a#pile1'], modelVersionId: 'a' }]);
  assert.equal(f.completed[0].selectedCount, 2);
  f.controller.destroy();
  assert.equal(f.canvas.count(), 0);
  assert.equal(f.keyboardTarget.count(), 0);
});

test('stationary Ctrl/Cmd click selects exactly once, ordinary drag and measurement remain untouched', async () => {
  const f = fixture();
  f.setPicked('a#pile1');
  f.canvas.emit('pointerdown', { ctrlKey: false, metaKey: true });
  f.canvas.emit('pointerup', { ctrlKey: false, metaKey: true });
  f.canvas.emit('click', { ctrlKey: false, metaKey: true });
  assert.equal(f.publications.length, 1);
  f.canvas.emit('pointerdown', { ctrlKey: false });
  assert.equal(f.viewer.cameraControl.pointerEnabled, true);
  f.controller.destroy();
  const measured = fixture({ isInteractionCaptured: () => true });
  measured.drag();
  await settle();
  assert.equal(measured.publications.length, 0);
  assert.equal(measured.viewer.cameraControl.pointerEnabled, true);
  measured.controller.destroy();
});

test('Escape, lost capture, pointer cancel and blur restore prior camera state and preserve selection', () => {
  for (const type of ['keydown', 'lostpointercapture', 'pointercancel', 'blur']) {
    const f = fixture();
    f.controller.select(['a#pile1']);
    f.viewer.cameraControl.pointerEnabled = false;
    f.canvas.emit('pointerdown');
    f.canvas.emit('pointermove', { clientX: 270, clientY: 155 });
    (['keydown', 'blur'].includes(type) ? f.keyboardTarget : f.canvas).emit(type, { key: 'Escape' });
    assert.equal(f.viewer.cameraControl.pointerEnabled, false);
    assert.equal(f.overlays.size, 0);
    assert.deepEqual(f.viewer.scene.selectedObjectIds, ['a#pile1']);
    f.controller.destroy();
  }
});

test('bulk selection stays private, honors starting model and adds to its existing selection', async () => {
  const f = fixture();
  for (let i = 0; i < 160; i += 1) {
    const id = `b#thin-${i}`;
    f.viewer.scene.objects[id] = { id, visible: true, aabb: [-0.2, -0.2, -0.2, -0.19, 0.2, 0.2] };
  }
  f.setPicked('b#pile1');
  f.drag();
  await settle();
  assert.equal(f.viewer.scene.selectedObjectIds.length, 161);
  assert.equal(f.publications.length, 1);
  assert.equal(f.publications[0].identifiers.length, 1);
  assert.equal(f.publications[0].modelVersionId, 'b');
  f.controller.destroy();
});

test('rejected authority and model invalidation cannot apply rectangle candidates', async () => {
  for (const reject of [() => null, () => Promise.reject(new Error('denied'))]) {
    const f = fixture({ onSelectionSeedVerification: reject });
    f.controller.select(['b#pile1']);
    f.drag();
    await settle();
    assert.deepEqual(f.viewer.scene.selectedObjectIds, ['b#pile1']);
    assert.equal(f.completed.length, 0);
    f.controller.destroy();
  }
  let finish;
  const f = fixture({ onSelectionSeedVerification: () => new Promise((resolve) => { finish = resolve; }) });
  f.drag();
  await settle();
  f.controller.invalidateModel('a');
  finish({});
  await settle();
  assert.deepEqual(f.viewer.scene.selectedObjectIds, []);
  assert.equal(f.completed.length, 0);
  f.controller.destroy();
});

test('Escape cancels pending rectangle authorization even with no prior selection', async () => {
  let finish;
  const f = fixture({ onSelectionSeedVerification: () => new Promise((resolve) => { finish = resolve; }) });
  f.drag();
  await settle();
  f.keyboardTarget.emit('keydown', { key: 'Escape' });
  finish({});
  await settle();
  assert.deepEqual(f.viewer.scene.selectedObjectIds, []);
  f.controller.destroy();
});
