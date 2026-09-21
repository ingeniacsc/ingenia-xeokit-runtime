import assert from 'node:assert/strict';
import test from 'node:test';

import { createSelectionController } from '../../packages/viewer/src/xeokit/selection.js';

function createViewer() {
  const listeners = new Map();
  const canvas = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { listeners.delete(type); },
    getBoundingClientRect() { return { left: 10, top: 20 }; },
  };
  const selectedObjectIds = [];
  const viewer = {
    scene: {
      canvas: { canvas },
      selectedObjectIds,
      pick() { return { entity: { id: 'wall-1' } }; },
      setObjectsSelected(ids, selected) {
        if (!selected) selectedObjectIds.splice(0, selectedObjectIds.length);
        else selectedObjectIds.push(...ids);
      },
    },
  };
  return { listener: (type) => listeners.get(type), selectedObjectIds, viewer };
}

test('a touch tap selects once and suppresses its synthetic click', () => {
  const { listener, selectedObjectIds, viewer } = createViewer();
  const picked = [];
  const controller = createSelectionController(viewer, (payload) => picked.push(payload));

  listener('pointerdown')({ pointerId: 7, pointerType: 'touch', clientX: 110, clientY: 70 });
  listener('pointerup')({ pointerId: 7, pointerType: 'touch', clientX: 112, clientY: 71 });
  listener('click')({ clientX: 112, clientY: 71 });

  assert.deepEqual(picked, [{ identifiers: ['wall-1'] }]);
  assert.deepEqual(selectedObjectIds, ['wall-1']);
  controller.destroy();
});

test('a touch drag or pointer cancel does not select', () => {
  const { listener, selectedObjectIds, viewer } = createViewer();
  const picked = [];
  const controller = createSelectionController(viewer, (payload) => picked.push(payload));

  listener('pointerdown')({ pointerId: 9, pointerType: 'touch', clientX: 20, clientY: 30 });
  listener('pointerup')({ pointerId: 9, pointerType: 'touch', clientX: 60, clientY: 70 });
  listener('pointerdown')({ pointerId: 10, pointerType: 'pen', clientX: 20, clientY: 30 });
  listener('pointercancel')({ pointerId: 10 });
  listener('pointerup')({ pointerId: 10, pointerType: 'pen', clientX: 20, clientY: 30 });

  assert.deepEqual(picked, []);
  assert.deepEqual(selectedObjectIds, []);
  controller.destroy();
  assert.equal(listener('pointerdown'), undefined);
  assert.equal(listener('pointerup'), undefined);
  assert.equal(listener('pointercancel'), undefined);
});
