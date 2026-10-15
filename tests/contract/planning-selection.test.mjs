import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlanningSelectionPayload, createProtocolEnvelope, validateProtocolEnvelope } from '../../packages/protocol/src/index.js';
import { createViewerBridge } from '../../packages/viewer/src/protocol-bridge/bridge.js';
const base = { operationId: '22222222-2222-4222-8222-222222222222', modelVersionId: '11111111-1111-4111-8111-111111111111' };
test('bounded planning command action schemas', () => {
  for (const payload of [{ action: 'begin', total: 14001 }, { action: 'append', offset: 0, globalIds: ['0000000000000000000001'] }, { action: 'commit' }, { action: 'cancel' }]) assert.equal(validatePlanningSelectionPayload({ ...base, ...payload }).ok, true);
  for (const payload of [{ action: 'begin', total: 50001 }, { action: 'append', offset: 0, globalIds: ['bad'] }, { action: 'commit', globalIds: [] }, { action: 'begin', total: 1, token: 'secret' }]) assert.equal(validatePlanningSelectionPayload({ ...base, ...payload }).ok, false);
});
test('planning command is recognized as a bounded host envelope', () => {
  const envelope = createProtocolEnvelope({ sessionId: 'session.123456789012', nonce: 'nonce.12345678901234',
    stateRevision: 0, source: 'host', type: 'selection.planning', payload: { ...base, action: 'begin', total: 14001 } });
  assert.equal(validateProtocolEnvelope(envelope).ok, true);
  assert.equal(validateProtocolEnvelope({ ...envelope, payload: { ...envelope.payload, total: 50001 } }).ok, false);
});
test('planning selection requires optional capability and ACKs only after handler completion', async () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const listeners = new Map();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: (type) => listeners.delete(type),
    setTimeout: () => 1, clearTimeout() {},
  } });
  try {
    for (const allowed of [false, true]) {
      const sent = []; let applied = false;
      const parentWindow = { postMessage: (message) => sent.push(message) };
      const sessionId = 'session.123456789012', nonce = 'nonce.12345678901234';
      const bridge = createViewerBridge({ parentWindow, parentOrigin: 'https://host.example', sessionId, nonce,
        viewerBuild: 'build.123456789012', handlers: { selection: { planning: async () => { applied = true; } } } });
      const send = (type, payload) => listeners.get('message')({ origin: 'https://host.example', source: parentWindow,
        data: createProtocolEnvelope({ sessionId, nonce, source: 'host', stateRevision: (sent.at(-1)?.stateRevision || 0) + 1, type, payload }) });
      await send('host.initialize', { requestedCapabilities: allowed ? ['planning-selection'] : ['selection'] });
      await send('selection.planning', { ...base, action: 'begin', total: 1 });
      assert.equal(applied, allowed);
      assert.equal(sent.at(-1).type, allowed ? 'request.ack' : 'request.error');
      if (allowed) assert.deepEqual(Object.keys(sent.at(-1).payload), ['requestId']);
      bridge.destroy();
    }
  } finally {
    if (prior) Object.defineProperty(globalThis, 'window', prior); else delete globalThis.window;
  }
});
