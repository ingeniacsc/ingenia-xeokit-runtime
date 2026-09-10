import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelectionController } from '../../packages/viewer/src/xeokit/selection.js';

function createViewer() {
  const listeners = new Map();
  const keyboardListeners = new Map();
  const selected = new Set();
  let pickedId = 'wall-1';
  const canvas = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    getBoundingClientRect() { return { left: 10, top: 20, width: 200, height: 100 }; },
  };
  const keyboardTarget = {
    addEventListener(type, listener) { keyboardListeners.set(type, listener); },
    removeEventListener(type) { keyboardListeners.delete(type); },
  };
  const objects = {
    'wall-1': { id: 'wall-1', visible: true },
    'wall-2': { id: 'wall-2', visible: true },
    'pipe-1': { id: 'pipe-1', visible: false },
  };
  const viewer = {
    metaScene: {
      metaObjects: {
        'wall-1': { type: 'IfcWall', parent: 'storey-1' },
        'wall-2': { type: 'IfcWall', parent: 'storey-1' },
        'pipe-1': { type: 'IfcPipeSegment', parent: 'storey-2' },
        'storey-1': { id: 'storey-1', type: 'IfcBuildingStorey', name: 'Level 01' },
        'storey-2': { id: 'storey-2', type: 'IfcBuildingStorey', name: 'Level 02' },
      },
    },
    scene: {
      canvas: { canvas },
      objects,
      get selectedObjectIds() { return Array.from(selected); },
      pick() { return { entity: { id: pickedId } }; },
      setObjectsSelected(ids, value) {
        ids.forEach((id) => (value ? selected.add(id) : selected.delete(id)));
      },
    },
  };
  return {
    listener(type) { return listeners.get(type); },
    keyboardListener(type) { return keyboardListeners.get(type); },
    keyboardTarget,
    setPicked(id) { pickedId = id; },
    viewer,
  };
}

test('Escape clears the selected objects without taking over text input', () => {
  const { keyboardListener, keyboardTarget, viewer } = createViewer();
  const details = [];
  const cleared = [];
  const controller = createSelectionController(
    viewer,
    () => {},
    () => {},
    {
      keyboardTarget,
      onSelectionCleared: () => cleared.push(true),
      onSelectionDetails: (payload) => details.push(payload),
    },
  );
  controller.select(['wall-1']);

  keyboardListener('keydown')({ key: 'Escape', target: { tagName: 'INPUT' } });
  assert.deepEqual(viewer.scene.selectedObjectIds, ['wall-1']);

  let prevented = false;
  keyboardListener('keydown')({
    key: 'Escape',
    target: { tagName: 'DIV' },
    preventDefault() { prevented = true; },
  });

  assert.equal(prevented, true);
  assert.deepEqual(viewer.scene.selectedObjectIds, []);
  assert.deepEqual(details, [
    { identifiers: ['wall-1'], scope: 'single' },
    { identifiers: [], scope: 'selection' },
  ]);
  assert.deepEqual(cleared, [true]);
  controller.destroy();
  assert.equal(keyboardListener('keydown'), undefined);
});

test('selection appearance is reapplied after selecting and clearing objects', () => {
  const { viewer } = createViewer();
  let appearanceUpdates = 0;
  const controller = createSelectionController(viewer, () => {}, () => {}, {
    onSelectionAppearanceChanged: () => { appearanceUpdates += 1; },
  });

  controller.select(['wall-1']);
  controller.clear();

  assert.equal(appearanceUpdates, 2);
  controller.destroy();
});

test('isolated selection preserves right-click multi-selection and normalizes its anchor', () => {
  const { listener, viewer } = createViewer();
  const contextMenus = [];
  const details = [];
  const controller = createSelectionController(
    viewer,
    () => {},
    (payload) => contextMenus.push(payload),
    { onSelectionDetails: (payload) => details.push(payload) },
  );
  controller.select(['wall-1', 'wall-2']);
  details.length = 0;

  let prevented = false;
  listener('contextmenu')({
    clientX: 110,
    clientY: 70,
    preventDefault() { prevented = true; },
  });

  assert.equal(prevented, true);
  assert.deepEqual(contextMenus, [{
    identifiers: ['wall-1', 'wall-2'],
    anchor: { x: 0.5, y: 0.5 },
  }]);
  assert.deepEqual(details, []);
  controller.destroy();
});

test('Revit-style modifier clicks add with Ctrl or Cmd and remove with Shift', () => {
  const { listener, setPicked, viewer } = createViewer();
  const controller = createSelectionController(viewer, () => {});
  controller.select(['wall-1']);

  setPicked('wall-2');
  listener('click')({ clientX: 110, clientY: 70, ctrlKey: true });
  assert.deepEqual(viewer.scene.selectedObjectIds, ['wall-1', 'wall-2']);

  setPicked('wall-1');
  listener('click')({ clientX: 110, clientY: 70, shiftKey: true });
  assert.deepEqual(viewer.scene.selectedObjectIds, ['wall-2']);

  listener('click')({ clientX: 110, clientY: 70, shiftKey: true });
  assert.deepEqual(viewer.scene.selectedObjectIds, ['wall-2']);

  listener('click')({ clientX: 110, clientY: 70, metaKey: true });
  assert.deepEqual(viewer.scene.selectedObjectIds, ['wall-2', 'wall-1']);

  listener('click')({ clientX: 110, clientY: 70, metaKey: true });
  assert.deepEqual(viewer.scene.selectedObjectIds, ['wall-2', 'wall-1']);
  controller.destroy();
});

test('canvas click retains local orbit-pivot handling before selection authorization', () => {
  const { listener, viewer } = createViewer();
  const pivotEvents = [];
  const controller = createSelectionController(viewer, () => {}, () => {}, {
    onOrbitPivot: (event) => pivotEvents.push([event.clientX, event.clientY]),
  });

  listener('click')({ clientX: 110, clientY: 70 });

  assert.deepEqual(pivotEvents, [[110, 70]]);
  assert.deepEqual(viewer.scene.selectedObjectIds, ['wall-1']);
  controller.destroy();
});

test('modifier selection keeps every local object after its public references are bounded', () => {
  const { listener, setPicked, viewer } = createViewer();
  const published = [];
  const selectedIds = Array.from({ length: 50 }, (_, index) => `model-a#wall-${index + 1}`);
  selectedIds.forEach((id) => {
    viewer.scene.objects[id] = { id, visible: true };
  });
  viewer.scene.objects['model-a#wall-51'] = { id: 'model-a#wall-51', visible: true };
  const controller = createSelectionController(viewer, (payload) => published.push(payload));
  controller.select(selectedIds);
  setPicked('model-a#wall-51');

  listener('click')({ clientX: 110, clientY: 70, ctrlKey: true });

  assert.equal(viewer.scene.selectedObjectIds.length, 51);
  assert.deepEqual(published, [{
    identifiers: ['model-a#wall-1'],
    modelVersionId: 'model-a',
  }]);
  controller.destroy();
});

test('context menu preserves a mass selection while publishing only its bounded seed', () => {
  const { listener, setPicked, viewer } = createViewer();
  const contextMenus = [];
  const selectedIds = Array.from({ length: 55 }, (_, index) => `model-a#wall-${index + 1}`);
  selectedIds.forEach((id) => {
    viewer.scene.objects[id] = { id, visible: true };
  });
  const controller = createSelectionController(
    viewer,
    () => {},
    (payload) => contextMenus.push(payload),
  );
  controller.select(selectedIds);
  setPicked('model-a#wall-1');

  listener('contextmenu')({ clientX: 110, clientY: 70, preventDefault() {} });

  assert.deepEqual(contextMenus, [{
    identifiers: ['model-a#wall-1'],
    modelVersionId: 'model-a',
    anchor: { x: 0.5, y: 0.5 },
  }]);
  assert.deepEqual(viewer.scene.selectedObjectIds, selectedIds);
  controller.destroy();
});

test('isolated selection keeps visible and IFC type actions within the iframe runtime', async () => {
  const { viewer } = createViewer();
  const picked = [];
  const controller = createSelectionController(viewer, (payload) => picked.push(payload));

  assert.deepEqual(await controller.selectVisible(['wall-1']), ['wall-1', 'wall-2']);
  assert.deepEqual(await controller.match(['wall-1'], 'type'), ['wall-1', 'wall-2']);
  assert.deepEqual(await controller.match(['wall-1'], 'storey'), ['wall-1', 'wall-2']);
  assert.deepEqual(picked, [
    { identifiers: ['wall-1'] },
    { identifiers: ['wall-1'] },
    { identifiers: ['wall-1'] },
  ]);
  controller.destroy();
});

test('isolated identical matching uses technical BIM properties instead of object identity', async () => {
  const { viewer } = createViewer();
  const picked = [];
  Object.assign(viewer.metaScene.metaObjects, {
    'wall-1': {
      type: 'IfcWall',
      name: 'Wall-001',
      propertySets: [{
        name: 'Pset_WallCommon',
        properties: [{ name: 'Reference', value: 'W-200' }, { name: 'Fire Rating', value: 'EI60' }],
      }],
    },
    'wall-2': {
      type: 'IfcWall',
      name: 'Wall-002',
      propertySets: [{
        name: 'Pset_WallCommon',
        properties: [{ name: 'Reference', value: 'W-200' }, { name: 'Fire Rating', value: 'EI60' }],
      }],
    },
  });
  const controller = createSelectionController(viewer, (payload) => picked.push(payload));

  assert.deepEqual(await controller.match(['wall-1'], 'exact'), ['wall-1', 'wall-2']);
  assert.deepEqual(picked, [{ identifiers: ['wall-1'] }]);
  controller.destroy();
});

test('a missing local technical match value keeps selection on its visible source object', async () => {
  const { viewer } = createViewer();
  const controller = createSelectionController(viewer, () => {});

  assert.deepEqual(await controller.match(['wall-1'], 'system'), ['wall-1']);
  assert.deepEqual(viewer.scene.selectedObjectIds, ['wall-1']);
  controller.destroy();
});

test('isolated selection publishes a local property-panel scope without exposing metadata', async () => {
  const { viewer } = createViewer();
  const details = [];
  const controller = createSelectionController(
    viewer,
    () => {},
    () => {},
    { onSelectionDetails: (payload) => details.push(payload) },
  );

  controller.select(['wall-1']);
  await controller.match(['wall-1'], 'type');
  controller.clear();

  assert.deepEqual(details, [
    { identifiers: ['wall-1'], scope: 'single' },
    { identifiers: [], scope: 'selection' },
  ]);
  controller.destroy();
});

test('isolated selection supports an explicit multi-select mode for touch controls', () => {
  const { listener, setPicked, viewer } = createViewer();
  const picked = [];
  const controller = createSelectionController(viewer, (payload) => picked.push(payload));

  assert.equal(controller.setMode('multi'), 'multi');
  listener('click')({ clientX: 20, clientY: 30 });
  setPicked('wall-2');
  listener('click')({ clientX: 20, clientY: 30 });
  setPicked('wall-1');
  listener('click')({ clientX: 20, clientY: 30 });

  assert.deepEqual(picked, [
    { identifiers: ['wall-1'] },
    { identifiers: ['wall-1', 'wall-2'] },
    { identifiers: ['wall-2'] },
  ]);
  assert.deepEqual(viewer.scene.selectedObjectIds, ['wall-2']);
  controller.destroy();
});

test('a verified single selection remains rendered after an async publication', async () => {
  const { listener, viewer } = createViewer();
  let releasePublication;
  const publication = new Promise((resolve) => { releasePublication = resolve; });
  const controller = createSelectionController(viewer, () => publication);

  listener('click')({ clientX: 20, clientY: 30 });
  assert.deepEqual(viewer.scene.selectedObjectIds, []);

  releasePublication();
  await publication;
  await Promise.resolve();

  assert.deepEqual(viewer.scene.selectedObjectIds, ['wall-1']);
  controller.destroy();
});

test('isolated selection keeps context menu available while point picking is captured', () => {
  const { listener, viewer } = createViewer();
  const picked = [];
  const contextMenus = [];
  const controller = createSelectionController(
    viewer,
    (payload) => picked.push(payload),
    (payload) => contextMenus.push(payload),
    { isInteractionCaptured: () => true },
  );

  listener('click')({ clientX: 110, clientY: 70 });
  assert.deepEqual(picked, []);

  let prevented = false;
  listener('contextmenu')({
    clientX: 110,
    clientY: 70,
    preventDefault() { prevented = true; },
  });

  assert.equal(prevented, true);
  assert.deepEqual(contextMenus, [{
    identifiers: ['wall-1'],
    anchor: { x: 0.5, y: 0.5 },
  }]);
  controller.destroy();
});

test('isolated context menu identifies the clicked federation model capability', () => {
  const { listener, setPicked, viewer } = createViewer();
  const contextMenus = [];
  const controller = createSelectionController(viewer, () => {}, (payload) => contextMenus.push(payload));
  Object.assign(viewer.scene.objects, {
    'model-a#wall-1': { id: 'model-a#wall-1', visible: true },
    'model-a#wall-2': { id: 'model-a#wall-2', visible: true },
    'model-b#pipe-1': { id: 'model-b#pipe-1', visible: true },
  });
  controller.select(['model-a#wall-1', 'model-a#wall-2', 'model-b#pipe-1']);
  setPicked('model-a#wall-1');

  listener('contextmenu')({
    clientX: 110,
    clientY: 70,
    preventDefault() {},
  });

  assert.deepEqual(contextMenus, [{
    identifiers: ['model-a#wall-1', 'model-a#wall-2'],
    anchor: { x: 0.5, y: 0.5 },
    modelVersionId: 'model-a',
  }]);
  controller.destroy();
});

test('isolated object picks identify their federation model capability', () => {
  const { listener, setPicked, viewer } = createViewer();
  const picked = [];
  const controller = createSelectionController(viewer, (payload) => picked.push(payload));
  Object.assign(viewer.scene.objects, {
    'model-b#pipe-1': { id: 'model-b#pipe-1', visible: true },
  });
  setPicked('model-b#pipe-1');

  listener('click')({ clientX: 110, clientY: 70 });

  assert.deepEqual(picked, [{
    identifiers: ['model-b#pipe-1'],
    modelVersionId: 'model-b',
  }]);
  controller.destroy();
});

test('isolated multi-select and match actions remain within one federation model', async () => {
  const { listener, setPicked, viewer } = createViewer();
  const picked = [];
  const controller = createSelectionController(viewer, (payload) => picked.push(payload));
  Object.assign(viewer.scene.objects, {
    'model-a#wall-1': { id: 'model-a#wall-1', visible: true },
    'model-a#wall-2': { id: 'model-a#wall-2', visible: true },
    'model-b#wall-1': { id: 'model-b#wall-1', visible: true },
  });
  Object.assign(viewer.metaScene.metaObjects, {
    'model-a#wall-1': { type: 'IfcWall' },
    'model-a#wall-2': { type: 'IfcWall' },
    'model-b#wall-1': { type: 'IfcWall' },
  });

  controller.setMode('multi');
  setPicked('model-a#wall-1');
  listener('click')({ clientX: 110, clientY: 70 });
  setPicked('model-b#wall-1');
  listener('click')({ clientX: 110, clientY: 70 });

  assert.deepEqual(viewer.scene.selectedObjectIds, ['model-b#wall-1']);
  assert.deepEqual(picked.slice(-1), [{
    identifiers: ['model-b#wall-1'],
    modelVersionId: 'model-b',
  }]);

  assert.deepEqual(await controller.match(['model-a#wall-1'], 'type'), [
    'model-a#wall-1',
    'model-a#wall-2',
  ]);
  assert.deepEqual(picked.slice(-1), [{
    identifiers: ['model-a#wall-1'],
    modelVersionId: 'model-a',
  }]);
  controller.destroy();
});

test('isolated matching selects every visible match while authorizing only its source object', async () => {
  const { viewer } = createViewer();
  const published = [];
  const progress = [];
  const completed = [];
  for (let index = 1; index <= 55; index += 1) {
    const id = `model-a#wall-${index}`;
    viewer.scene.objects[id] = { id, visible: true };
    viewer.metaScene.metaObjects[id] = { type: 'IfcWall' };
  }
  const controller = createSelectionController(
    viewer,
    (payload) => published.push(payload),
    () => {},
    {
      onSelectionOperationComplete: (payload) => completed.push(payload),
      onSelectionOperationProgress: (payload) => progress.push(payload),
    },
  );

  const selected = await controller.match(['model-a#wall-1'], 'type');

  assert.equal(selected.length, 55);
  assert.deepEqual(published, [{ identifiers: ['model-a#wall-1'], modelVersionId: 'model-a' }]);
  assert.equal(progress.at(-1).matched, 55);
  assert.deepEqual(completed, [{ scope: 'type', selectedCount: 55 }]);
  assert.equal(viewer.scene.selectedObjectIds.length, 55);
  controller.destroy();
});

test('candidate selection is not rendered when authoritative reference creation fails', async () => {
  const { viewer } = createViewer();
  const controller = createSelectionController(
    viewer,
    async () => { throw new Error('selection reference rejected'); },
  );
  controller.select(['wall-2']);

  await assert.rejects(controller.match(['wall-1'], 'type'), /selection reference rejected/);
  assert.deepEqual(viewer.scene.selectedObjectIds, ['wall-2']);
  controller.destroy();
});

test('a stale authority completion cannot overwrite a newer selection', async () => {
  const { viewer } = createViewer();
  viewer.scene.objects['pipe-1'].visible = true;
  let releaseFirst;
  const firstPublication = new Promise((resolve) => { releaseFirst = resolve; });
  const controller = createSelectionController(viewer, (payload) => (
    payload.identifiers.includes('wall-1') ? firstPublication : Promise.resolve()
  ));

  const stale = controller.match(['wall-1'], 'type');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const current = controller.match(['pipe-1'], 'type');
  assert.deepEqual(await current, ['pipe-1']);
  releaseFirst();
  assert.deepEqual(await stale, ['pipe-1']);
  assert.deepEqual(viewer.scene.selectedObjectIds, ['pipe-1']);
  controller.destroy();
});

test('a stale chunked match scan cannot overwrite a newer local selection', async () => {
  const { viewer } = createViewer();
  for (let index = 0; index < 1_002; index += 1) {
    const id = `model-a#wall-${index}`;
    viewer.scene.objects[id] = { id, visible: true };
    viewer.metaScene.metaObjects[id] = { type: 'IfcWall' };
  }
  const controller = createSelectionController(viewer, () => Promise.resolve());

  const stale = controller.match(['model-a#wall-0'], 'type');
  controller.select(['pipe-1']);

  assert.deepEqual(await stale, ['pipe-1']);
  assert.deepEqual(viewer.scene.selectedObjectIds, ['pipe-1']);
  controller.destroy();
});

test('technical match cache is invalidated when a federated model is removed', async () => {
  const { viewer } = createViewer();
  viewer.scene.objects['model-a#wall-1'] = { id: 'model-a#wall-1', visible: true };
  viewer.scene.objects['model-a#wall-2'] = { id: 'model-a#wall-2', visible: true };
  viewer.metaScene.metaObjects['model-a#wall-1'] = { type: 'IfcWall' };
  viewer.metaScene.metaObjects['model-a#wall-2'] = { type: 'IfcWall' };
  const controller = createSelectionController(viewer, () => Promise.resolve());

  assert.deepEqual(await controller.match(['model-a#wall-1'], 'type'), ['model-a#wall-1', 'model-a#wall-2']);
  viewer.metaScene.metaObjects['model-a#wall-2'].type = 'IfcDoor';
  controller.invalidateModel('model-a');

  assert.deepEqual(await controller.match(['model-a#wall-1'], 'type'), ['model-a#wall-1']);
});

test('technical matching honors the per-model field access mask', async () => {
  const { viewer } = createViewer();
  const controller = createSelectionController(
    viewer,
    () => Promise.resolve(),
    () => Promise.resolve(),
    {
      resolveTechnicalPropertyAccess: () => ({
        ifcType: true,
        storey: true,
        propertySets: false,
      }),
    },
  );

  assert.deepEqual(await controller.match(['wall-1'], 'type'), ['wall-1', 'wall-2']);
  await assert.rejects(
    controller.match(['wall-1'], 'exact'),
    /not authorized/,
  );
  controller.destroy();
});

test('technical matching fails closed when its work budget is exhausted', async () => {
  const { viewer } = createViewer();
  const controller = createSelectionController(
    viewer,
    () => Promise.resolve(),
    () => Promise.resolve(),
    { matchWorkUnitLimit: 1 },
  );

  await assert.rejects(
    controller.match(['wall-1'], 'type'),
    /safe work limit/,
  );
  assert.deepEqual(viewer.scene.selectedObjectIds, []);
  controller.destroy();
});
