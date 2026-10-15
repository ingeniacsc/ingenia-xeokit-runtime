import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanningSelection } from '../../packages/viewer/src/xeokit/planning-selection.js';
const modelVersionId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const guid = (i) => `0${String(i).padStart(21, '0')}`;
function fixture(n = 2, timeoutMs = 60000) {
  let descriptors = [{ modelId: modelVersionId, revision: 'r1' }];
  let allowed = true, revision = 0;
  const selected = [];
  const objects = Object.fromEntries(Array.from({ length: n }, (_, i) => [`${modelVersionId}#${guid(i)}`, {}]));
  const controller = createPlanningSelection({ timeoutMs,
    model: { listDescriptors: () => descriptors, modelVersionIdFor: () => modelVersionId, isObjectAllowed: () => allowed },
    viewer: { scene: { objects } }, selection: { getRevision: () => revision, select: (ids) => { selected.push(ids); return ids; }, clear: () => {} } });
  const send = (action, extra = {}) => controller.request({ action, operationId, modelVersionId, ...extra });
  return { controller, send, selected, revoke: () => { allowed = false; }, change: () => { descriptors = []; }, interact: () => revision++ };
}
test('stages all 14001 scoped objects and applies exactly once', () => {
  const f = fixture(14001); f.send('begin', { total: 14001 });
  for (let offset = 0; offset < 14001; offset += 500) f.send('append', { offset, globalIds: Array.from({ length: Math.min(500, 14001 - offset) }, (_, i) => guid(offset + i)) });
  assert.equal(f.selected.length, 0); f.send('commit');
  assert.equal(f.selected.length, 1); assert.equal(f.selected[0].length, 14001);
  assert.equal(f.selected[0][14000], `${modelVersionId}#${guid(14000)}`);
});
test('incomplete and duplicate pages never select partially', () => {
  const f = fixture(); f.send('begin', { total: 2 }); f.send('append', { offset: 0, globalIds: [guid(0)] });
  assert.throws(() => f.send('append', { offset: 1, globalIds: [guid(0)] })); assert.throws(() => f.send('commit')); assert.equal(f.selected.length, 0);
});
for (const mutation of ['revoke', 'change', 'interact']) test(`${mutation} invalidates commit`, () => {
  const f = fixture(); f.send('begin', { total: 1 }); f.send('append', { offset: 0, globalIds: [guid(0)] });
  f[mutation](); assert.throws(() => f.send('commit')); assert.equal(f.selected.length, 0);
});
test('cancel and timeout clear staged objects', async () => {
  const f = fixture(2, 5); f.send('begin', { total: 1 }); f.send('cancel'); assert.throws(() => f.send('commit'));
  f.send('begin', { total: 1 }); await new Promise((resolve) => setTimeout(resolve, 15)); assert.throws(() => f.send('commit')); f.controller.destroy();
});
test('wrong model GUID and oversized total rejected before selection', () => {
  const f = fixture(); assert.throws(() => f.send('begin', { total: 50001 }));
  f.send('begin', { total: 1 }); f.send('append', { offset: 0, globalIds: [guid(9)] }); assert.throws(() => f.send('commit')); assert.equal(f.selected.length, 0);
});
