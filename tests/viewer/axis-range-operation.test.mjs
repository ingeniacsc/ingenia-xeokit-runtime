import test from 'node:test';
import assert from 'node:assert/strict';
import { createAxisRangeOperation } from '../../packages/viewer/src/xeokit/axis-range-operation.js';
import { createSelectionReferencePages } from '../../packages/viewer/src/xeokit/selection-reference-pages.js';
const version = 'model-version-0000000001';
const bounds = { x: [0, 10], y: [0, 10], z: [0, 10] };
function fixture(count = 8, config = {}) {
  const ids = Array.from({ length: count }, (_, i) => `${version}#${i}`);
  const objects = Object.fromEntries(ids.map((id) => [id, { visible: true, selected: false, aabb: [1, 1, -2, 2, 2, -1] }]));
  objects.other = { visible: true, selected: true, aabb: [1, 1, -2, 2, 2, -1] };
  objects[`${version}#denied`] = { visible: false, selected: false, aabb: [1, 1, -2, 2, 2, -1] };
  const denied = new Set([`${version}#denied`]), publications = [], calls = [];
  const scene = {
    objects, get objectIds() { return Object.keys(objects); },
    get selectedObjectIds() { return this.objectIds.filter((id) => objects[id].selected); },
    setObjectsVisible(batch, value) { calls.push(batch.length); batch.forEach((id) => { objects[id].visible = value; }); },
    setObjectsSelected(batch, value) { calls.push(batch.length); batch.forEach((id) => { objects[id].selected = value; }); },
    render() {},
  };
  const operation = createAxisRangeOperation({ scene }, {
    filterAllowedObjectIds: (batch) => batch.filter((id) => !denied.has(id)),
    onSelect: (...args) => publications.push(args), yieldFrame: async () => {}, ...config,
  });
  return { operation, scene, ids, denied, publications, calls,
    visible: () => scene.objectIds.filter((id) => objects[id].visible),
    run: (spec = {}) => operation.run({ modelId: version, bounds, mode: 'contained', ...spec }) };
}
test('XYZ isolate leaves no selection; all three limits affect candidates; clear restores prior visibility', async () => {
  const f = fixture();
  f.scene.objects[f.ids[0]].aabb = [20, 1, -2, 21, 2, -1]; // X outside
  f.scene.objects[f.ids[1]].aabb = [1, 20, -2, 2, 21, -1]; // engineering Z outside
  f.scene.objects[f.ids[2]].aabb = [1, 1, -21, 2, 2, -20]; // engineering Y outside
  f.scene.objects[f.ids[3]].aabb = null;
  const before = f.visible();
  assert.deepEqual(await f.run(), { count: 4, missing: 1, boundary: 0 });
  assert.deepEqual(f.visible(), f.ids.slice(4));
  assert.deepEqual(f.scene.selectedObjectIds, []);
  await f.operation.selectAll();
  assert.deepEqual(f.scene.selectedObjectIds, f.ids.slice(4));
  await f.operation.clear();
  assert.deepEqual(f.visible(), before);
  assert.deepEqual(f.scene.selectedObjectIds, []);
});
test('14001 selected region elements export through all pages; no one-GUID truncation', async () => {
  const f = fixture(14001);
  await f.run();
  assert.deepEqual(f.scene.selectedObjectIds, []);
  await f.operation.selectAll();
  assert.equal(f.scene.selectedObjectIds.length, 14001);
  assert.ok(Math.max(...f.calls) <= 256);
  assert.equal(f.publications.at(-1)[0].identifiers.length, 1); // bounded UI seed only
  let sequence = 0;
  const exportPages = createSelectionReferencePages({
    getObjectIds: () => f.operation.isBusy() ? [] : f.scene.selectedObjectIds,
    getRevision: () => String(f.operation.getRevision()), modelVersionIdFor: () => version,
    isObjectAllowed: (id) => !f.denied.has(id) && f.scene.objects[id].visible,
    createReferences: async (ids) => ids.map(() => `selection.session.reference-${String(++sequence).padStart(16, '0')}`),
    createSnapshotId: () => 'snapshot-0000000000001',
  });
  let page = await exportPages.request({ offset: 0 }), count = page.identifiers.length;
  while (!page.done) { page = await exportPages.request({ offset: count, snapshotId: page.snapshotId }); count += page.identifiers.length; }
  assert.equal(count, 14001);
  await f.operation.clear();
  await assert.rejects(exportPages.request({ offset: count, snapshotId: page.snapshotId }), /changed|expired/);
});
test('cancel during visibility update restores original scene, excludes revoked and removed objects', async () => {
  let f, tick = 0;
  f = fixture(600, { yieldFrame: async () => {
    if (++tick === 5) {
      f.denied.add(f.ids[1]); delete f.scene.objects[f.ids[0]];
      f.operation.cancel({ authorityChange: true });
    }
  } });
  assert.equal(await f.run(), null);
  assert.equal(f.scene.objects[f.ids[0]], undefined);
  assert.equal(f.scene.objects[f.ids[1]].visible, false);
  assert.equal(f.visible().length, 599); // 598 own + other
  assert.deepEqual(f.scene.selectedObjectIds, []);
});
test('replacement serializes cancellation; invalid and empty volumes never reveal foreign objects', async () => {
  let f, replacement, tick = 0;
  f = fixture(600, { yieldFrame: async () => { if (++tick === 5) replacement = f.run({ bounds: { ...bounds, x: [100, 200] } }); } });
  assert.equal(await f.run(), null);
  assert.equal((await replacement).count, 0);
  assert.deepEqual(f.visible(), []);
  await assert.rejects(f.run({ bounds: { ...bounds, z: [10, 0] } }));
  assert.deepEqual(f.visible(), []);
});
test('clear after new model preserves new geometry and rechecks authority', async () => {
  const f = fixture(); await f.run();
  f.scene.objects.new = { visible: true, selected: false };
  f.denied.add(f.ids[0]);
  await f.operation.clear({ authorityChange: true });
  assert.equal(f.scene.objects.new.visible, true);
  assert.equal(f.scene.objects[f.ids[0]].visible, false);
});
