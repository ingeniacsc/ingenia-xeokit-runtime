import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createModelController } from '../../packages/viewer/src/xeokit/model.js';

const content = new Uint8Array([1, 2, 3, 4]);
const contentHash = createHash('sha256').update(content).digest('hex');
const descriptor = (modelId) => ({ modelId, format: 'xkt', artifactUrl: `https://viewer.invalid/${modelId}`, contentHash, preserveCamera: true });
async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for loader');
}

for (const phase of ['fetch', 'scope', 'metadata', 'parse', 'reveal']) {
  test(`cancel during ${phase} preserves completed models and camera`, async (t) => {
    const models = new Map(), events = [];
    const viewer = { camera: { eye: [4, 5, 6], projection: 'ortho' },
      cameraFlight: { jumpTo: () => assert.fail('Cancellation must not refit camera') },
      scene: { objects: {}, selectedObjectIds: ['a#object'], render() {},
        setObjectsVisible(ids, visible) { ids.forEach((id) => { if (this.objects[id]) this.objects[id].visible = visible; }); } } };
    const camera = structuredClone(viewer.camera);
    const originalFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = originalFetch; });
    let pendingSignal;
    globalThis.fetch = async (url, options) => {
      if ((String(url).endsWith('/b') && phase === 'fetch')
        || String(url).endsWith('/pending-scope') || String(url).endsWith('/pending-metadata')) {
        pendingSignal = options.signal;
        return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
      }
      return { ok: true, arrayBuffer: async () => content.buffer };
    };
    const controller = createModelController({ viewer, onProgress: (e) => events.push(e), loader: { load({ id }) {
      const handlers = {};
      const object = { id: `${id}#object`, visible: false, aabb: [0, 0, 0, 1, 1, 1] };
      viewer.scene.objects[object.id] = object;
      const model = { numEntities: 1, handlers, on(name, fn) { handlers[name] = fn; },
        destroy() { model.destroyed = true; delete viewer.scene.objects[object.id]; } };
      models.set(id, model);
      return model;
    } } });
    t.after(() => controller.destroy());
    const first = controller.open(descriptor('a'));
    await until(() => models.get('a')?.handlers.loaded);
    models.get('a').handlers.loaded();
    await first;
    const retainedObject = viewer.scene.objects['a#object'];
    const second = controller.add({ ...descriptor('b'),
      ...(phase === 'scope' ? { geometryScopeUrl: 'https://viewer.invalid/pending-scope' } : {}),
      ...(phase === 'metadata' ? { metaModelUrl: 'https://viewer.invalid/pending-metadata' } : {}),
    });
    const rejected = assert.rejects(second, { name: 'AbortError' });
    if (['fetch', 'scope', 'metadata'].includes(phase)) await until(() => pendingSignal);
    else {
      await until(() => models.get('b')?.handlers.loaded);
      if (phase === 'reveal') {
        models.get('b').handlers.loaded();
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    controller.remove('b');
    await rejected;
    models.get('b')?.handlers.loaded(); // Late SDK completion must not revive it.
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(controller.list(), ['a']);
    assert.equal(models.get('a').destroyed, undefined);
    assert.equal(viewer.scene.objects['a#object'], retainedObject);
    assert.equal(retainedObject.visible, true);
    assert.equal(viewer.scene.objects['b#object'], undefined);
    assert.deepEqual(viewer.camera, camera);
    assert.deepEqual(viewer.scene.selectedObjectIds, ['a#object']);
    assert.equal(events.some((e) => e.modelId === 'b' && e.phase === 'ready'), false);
    if (pendingSignal) assert.equal(pendingSignal.aborted, true);
    globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => content.buffer });
    const retry = controller.add(descriptor('b'));
    const removedModel = models.get('b');
    await until(() => models.get('b') !== removedModel && models.get('b')?.handlers.loaded);
    models.get('b').handlers.loaded();
    await retry;
    assert.deepEqual(controller.list(), ['a', 'b']);
    assert.equal(viewer.scene.objects['a#object'], retainedObject);
  });
}
