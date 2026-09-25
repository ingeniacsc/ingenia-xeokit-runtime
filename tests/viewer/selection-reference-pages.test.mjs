// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelectionReferencePages } from '../../packages/viewer/src/xeokit/selection-reference-pages.js';
import { createSelectionController } from '../../packages/viewer/src/xeokit/selection.js';
import { createObjectIdentifierRegistry } from '../../packages/viewer/src/xeokit/object-identifiers.js';
import { createViewerBridge } from '../../packages/viewer/src/protocol-bridge/bridge.js';
import { createProtocolEnvelope } from '../../packages/protocol/src/index.js';

const MODEL = 'model.1234567890123456';
const OTHER_MODEL = 'model.abcdefghijklmnop';
const ref = (index) => `selection.session.${String(index).padStart(24, '0')}`;
function fixture(count = 51, overrides = {}) {
  let ids = Array.from({ length: count }, (_, index) => `${MODEL}#object-${index}`);
  let revision = 1;
  let currentTime = 0;
  let nextSnapshotId = 0;
  const denied = new Set();
  const calls = [];
  const pager = createSelectionReferencePages({
    getObjectIds: () => ids,
    getRevision: () => revision,
    isObjectAllowed: (id) => !denied.has(id),
    modelVersionIdFor: () => MODEL,
    createReferences: async (page) => {
      calls.push([...page]);
      return page.map((id) => ref(Number(id.split('-').at(-1))));
    },
    now: () => currentTime,
    createSnapshotId: () => `snapshot.${String(++nextSnapshotId).padStart(20, '0')}`,
    ...overrides,
  });
  return { pager, calls, denied,
    ids: () => ids,
    setIds: (value) => { ids = value; },
    invalidate: () => { revision += 1; },
    tick: (value) => { currentTime += value; },
  };
}
const hasCode = (code) => (error) => error.protocolCode === `SELECTION_EXPORT_${code}`;

for (const total of [1, 50, 51, 359]) {
  test(`exports all ${total} selected objects in pages of at most 50, then revalidates without network`, async () => {
    const f = fixture(total);
    const exported = [];
    let offset = 0;
    let snapshotId;
    let page;
    do {
      page = await f.pager.request({ offset, ...(snapshotId ? { snapshotId } : {}) });
      snapshotId = page.snapshotId;
      assert.equal(page.modelVersionId, MODEL);
      assert.equal(page.total, total);
      assert.equal(page.offset, offset);
      assert.equal(page.identifiers.length, Math.min(50, total - offset));
      exported.push(...page.identifiers);
      offset += page.identifiers.length;
    } while (!page.done);
    assert.deepEqual(exported, Array.from({ length: total }, (_, index) => ref(index)));
    assert.equal(f.calls.length, Math.ceil(total / 50));
    const terminal = await f.pager.request({ offset: total, snapshotId });
    assert.deepEqual(terminal, { snapshotId, modelVersionId: MODEL, identifiers: [], offset: total, total, done: true });
    assert.equal(f.calls.length, Math.ceil(total / 50));
    assert.equal(JSON.stringify(page).includes('#object-'), false);
    f.pager.destroy();
  });
}

test('fails explicitly for empty, oversized, duplicate, mixed-model, hidden or denied selection', async () => {
  for (const [count, code] of [[0, 'EMPTY'], [100001, 'LIMIT']]) {
    const f = fixture(count);
    await assert.rejects(f.pager.request({ offset: 0 }), hasCode(code));
    assert.equal(f.calls.length, 0);
  }
  const duplicates = fixture(2);
  duplicates.setIds([duplicates.ids()[0], duplicates.ids()[0]]);
  await assert.rejects(duplicates.pager.request({ offset: 0 }), hasCode('INVALID'));
  const mixed = fixture(2, { modelVersionIdFor: (id) => id.endsWith('-0') ? MODEL : OTHER_MODEL });
  await assert.rejects(mixed.pager.request({ offset: 0 }), hasCode('DENIED'));
  const denied = fixture(51);
  denied.denied.add(denied.ids()[50]);
  await assert.rejects(denied.pager.request({ offset: 0 }), hasCode('DENIED'));
  assert.equal(denied.calls.length, 0);
});

test('rejects malformed, skipped, repeated and superseded page requests', async () => {
  const f = fixture();
  for (const payload of [{}, { offset: -1 }, { offset: 1 }, { offset: 0.5 },
    { offset: 0, snapshotId: 'short' }, { offset: 0, identifiers: ['injected'] }]) {
    await assert.rejects(f.pager.request(payload), hasCode('INVALID'));
  }
  const first = await f.pager.request({ offset: 0 });
  await assert.rejects(f.pager.request({ offset: 51, snapshotId: first.snapshotId }), hasCode('STALE'));
  await assert.rejects(f.pager.request({ offset: 0, snapshotId: first.snapshotId }), hasCode('STALE'));
  const second = await f.pager.request({ offset: 0 });
  assert.notEqual(second.snapshotId, first.snapshotId);
  await assert.rejects(f.pager.request({ offset: 50, snapshotId: first.snapshotId }), hasCode('STALE'));
});

test('selection list, order, authority, expiry and permission changes invalidate continuation', async () => {
  for (const change of [
    (f) => f.setIds(f.ids().slice(1)),
    (f) => f.setIds([...f.ids()].reverse()),
    (f) => f.invalidate(),
    (f) => f.tick(120000),
    (f) => f.tick(-1),
    (f) => f.denied.add(f.ids()[0]),
  ]) {
    const f = fixture();
    const first = await f.pager.request({ offset: 0 });
    change(f);
    await assert.rejects(f.pager.request({ offset: 50, snapshotId: first.snapshotId }));
    assert.equal(f.calls.length, 1);
  }
});

test('changes during authorization and pending session destruction discard the network response', async () => {
  for (const change of [
    (f) => f.invalidate(),
    (f) => f.setIds([...f.ids()].reverse()),
    (f) => f.denied.add(f.ids()[0]),
    (f) => f.tick(120000),
    (f) => f.pager.destroy(),
  ]) {
    let resolve;
    const f = fixture(2, { createReferences: () => new Promise((done) => { resolve = done; }) });
    const request = f.pager.request({ offset: 0 });
    await assert.rejects(f.pager.request({ offset: 0 }), hasCode('BUSY'));
    change(f);
    resolve([ref(0), ref(1)]);
    await assert.rejects(request);
  }
});

test('raw IDs, malformed and duplicate backend references never cross the export boundary', async () => {
  for (const result of [undefined, [], [ref(0)], [ref(0), ref(0)],
    ['3r3P4fMeH7YuIKuaIOBVpf', ref(1)], [`${MODEL}#raw-id`, ref(1)]]) {
    const f = fixture(2, { createReferences: async () => result });
    await assert.rejects(f.pager.request({ offset: 0 }), hasCode('INVALID'));
  }
});

test('a denied later page invalidates the entire snapshot and sanitizes backend errors', async () => {
  let calls = 0;
  const f = fixture(51, { createReferences: async (page) => {
    if (calls++ > 0) throw new Error('private-capability-url raw-guid');
    return page.map((_, index) => ref(index));
  } });
  const first = await f.pager.request({ offset: 0 });
  await assert.rejects(f.pager.request({ offset: 50, snapshotId: first.snapshotId }), (error) => {
    assert.equal(error.protocolCode, 'SELECTION_EXPORT_DENIED');
    assert.equal(error.message.includes('private-capability'), false);
    assert.equal(error.message.includes('raw-guid'), false);
    return true;
  });
  await assert.rejects(f.pager.request({ offset: 50, snapshotId: first.snapshotId }), hasCode('STALE'));
});

test('reusing a reference from an earlier page is rejected instead of silently reducing the copied count', async () => {
  const f = fixture(51, { createReferences: async (page) => page.map((_, index) => ref(index)) });
  const first = await f.pager.request({ offset: 0 });
  await assert.rejects(f.pager.request({ offset: 50, snapshotId: first.snapshotId }), hasCode('INVALID'));
});

test('terminal revalidation catches a selection change after host-side context resolution', async () => {
  const f = fixture(2);
  const first = await f.pager.request({ offset: 0 });
  assert.equal(first.done, true);
  f.invalidate();
  await assert.rejects(f.pager.request({ offset: 2, snapshotId: first.snapshotId }), hasCode('STALE'));
});

test('export does not retire the context-menu reference or mutate the selected objects', async () => {
  const registry = createObjectIdentifierRegistry();
  const f = fixture(2);
  const ids = [...f.ids()];
  const menuReference = 'selection.session.contextmenu0000000000';
  registry.register(menuReference, ids[0]);
  await f.pager.request({ offset: 0 });
  assert.deepEqual(registry.toObjectIds([menuReference]), [ids[0]]);
  assert.deepEqual(f.ids(), ids);
});

test('selection revision accessor tracks selection, clear and model invalidation', () => {
  const selected = new Set();
  const canvas = { addEventListener() {}, removeEventListener() {} };
  const controller = createSelectionController({ scene: {
    canvas: { canvas },
    get selectedObjectIds() { return [...selected]; },
    setObjectsSelected(ids, value) { ids.forEach((id) => value ? selected.add(id) : selected.delete(id)); },
  } });
  const initial = controller.getRevision();
  controller.select([`${MODEL}#object-0`]);
  assert.ok(controller.getRevision() > initial);
  const selectionRevision = controller.getRevision();
  controller.clear();
  assert.ok(controller.getRevision() > selectionRevision);
  const clearedRevision = controller.getRevision();
  controller.invalidateModel(MODEL);
  assert.ok(controller.getRevision() > clearedRevision);
  controller.destroy();
});

test('bridge correlates reference pages and reports stale exports without exposing private identifiers', async () => {
  const listeners = new Map();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const sent = [];
  const parentWindow = { postMessage(message, origin) { sent.push({ message, origin }); } };
  const parentOrigin = 'https://host.example';
  const sessionId = 'session.1234567890';
  const nonce = 'nonce.123456789012';
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    setTimeout() { return 1; }, clearTimeout() {},
  } });
  const f = fixture();
  let bridge;
  const send = async (type, payload) => {
    const data = createProtocolEnvelope({ sessionId, nonce, source: 'host',
      stateRevision: sent.at(-1).message.stateRevision + 1, type, payload });
    await listeners.get('message')({ origin: parentOrigin, source: parentWindow, data });
    return data.requestId;
  };
  try {
    bridge = createViewerBridge({ parentWindow, parentOrigin, sessionId, nonce,
      viewerBuild: 'build.1234567890', handlers: { selection: { references: f.pager.request } } });
    await send('host.initialize', { requestedCapabilities: ['selection'] });
    const requestId = await send('selection.references.request', { offset: 0 });
    const result = sent.at(-1);
    assert.equal(result.origin, parentOrigin);
    assert.equal(result.message.type, 'selection.references.result');
    assert.equal(result.message.payload.requestId, requestId);
    assert.equal(result.message.payload.identifiers.length, 50);
    assert.equal(result.message.payload.total, 51);
    assert.equal(JSON.stringify(result.message).includes('#object-'), false);
    f.invalidate();
    const staleRequestId = await send('selection.references.request', {
      offset: 50, snapshotId: result.message.payload.snapshotId,
    });
    assert.equal(sent.at(-1).message.type, 'request.error');
    assert.equal(sent.at(-1).message.payload.requestId, staleRequestId);
    assert.equal(sent.at(-1).message.payload.code, 'SELECTION_EXPORT_STALE');
    assert.equal(JSON.stringify(sent.at(-1).message).includes('#object-'), false);
  } finally {
    bridge?.destroy();
    f.pager.destroy();
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  }
});
