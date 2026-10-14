// SPDX-License-Identifier: AGPL-3.0-only
import { buildAxisRange, classifyAxisRangeAabb } from './axis-range-geometry.js';

// Only loaded, capability-authorized objects participate. Geometry and bulk IDs
// remain local; the existing paged selection-reference export handles Copy GUID.
export function createAxisRangeOperation(viewer, {
  filterAllowedObjectIds = (ids) => ids, onStart, onSelect, onProgress = () => {},
  yieldFrame = () => new Promise((resolve) => setTimeout(resolve, 0)), batchSize = 256,
} = {}) {
  const scene = viewer.scene;
  let revision = 0, pending = 0, disposed = false, queue = Promise.resolve();
  let baseline = null, result = null, discardSelection = false;
  const existing = (ids) => ids.filter((id) => scene.objects[id]);
  const allowed = (ids) => filterAllowedObjectIds(existing(ids));
  const snapshot = () => ({
    all: [...scene.objectIds],
    visible: scene.objectIds.filter((id) => scene.objects[id]?.visible !== false),
    selected: [...scene.selectedObjectIds],
  });
  async function batches(ids, action, current = () => true, phase = 'apply') {
    for (let i = 0; i < ids.length; i += batchSize) {
      if (!current()) return false;
      action(ids.slice(i, i + batchSize));
      onProgress({ phase, processed: Math.min(i + batchSize, ids.length), total: ids.length });
      await yieldFrame();
    }
    return current();
  }
  const visible = (ids, value) => scene.setObjectsVisible(value ? allowed(ids) : existing(ids), value);
  const selected = (ids, value) => scene.setObjectsSelected(value ? allowed(ids) : existing(ids), value);
  async function restore(saved, selection = false) {
    await batches(saved.all, (ids) => { visible(ids, false); selected(ids, false); }, undefined, 'restore');
    await batches(saved.visible, (ids) => visible(ids, true), undefined, 'restore');
    if (selection && !discardSelection) await batches(saved.selected, (ids) => { if (!discardSelection) selected(ids, true); }, undefined, 'restore');
    scene.render?.(true);
  }
  function enqueue(work) {
    const token = ++revision;
    pending++;
    queue = queue.catch(() => {}).then(async () => {
      try {
        if (disposed || token !== revision) return null;
        return await work(() => !disposed && token === revision);
      } finally { pending--; }
    });
    return queue;
  }
  function cancel({ authorityChange = false } = {}) {
    revision++;
    if (authorityChange) discardSelection = true;
  }
  async function run({ modelId, ...spec }) {
    const range = buildAxisRange(spec); // Reject before touching visibility.
    if (!modelId) throw new Error('A model version is required.');
    return enqueue(async (current) => {
      onStart?.();
      const before = snapshot(), previousResult = result;
      const candidates = allowed(scene.objectIds.filter((id) => id.startsWith(`${modelId}#`)));
      const ids = [];
      let missing = 0, boundary = 0;
      const classified = await batches(candidates, (batch) => {
        for (const id of batch) {
          const kind = classifyAxisRangeAabb(scene.objects[id]?.aabb, range);
          if (kind === 'missing') missing++;
          if (kind === 'boundary') boundary++;
          if (kind === 'inside' || (spec.mode === 'intersects' && kind === 'boundary')) ids.push(id);
        }
      }, current, 'classify');
      if (!classified) { onProgress({ phase: 'cancelled' }); return null; }
      try {
        const hidden = await batches(before.all, (batch) => { visible(batch, false); selected(batch, false); }, current);
        const applied = hidden && await batches(ids, (batch) => visible(batch, true), current);
        if (!applied) {
          await restore(before, true);
          onProgress({ phase: 'cancelled' });
          return null;
        }
        baseline ||= before;
        discardSelection = false;
        result = { modelId, ids: allowed(ids), missing, boundary };
        onSelect?.(null, current);
        scene.render?.(true);
        onProgress({ phase: 'done', processed: result.ids.length, total: result.ids.length });
        return { count: result.ids.length, missing, boundary };
      } catch (error) {
        result = previousResult;
        await restore(before, true);
        onProgress({ phase: 'error' });
        throw error;
      }
    });
  }
  function selectAll() {
    return enqueue(async (current) => {
      if (!result) return null;
      onStart?.();
      const before = [...scene.selectedObjectIds];
      const ids = allowed(result.ids).filter((id) => {
        const entity = scene.objects[id];
        return entity.visible !== false && entity.pickable !== false && entity.culled !== true;
      });
      const cleared = await batches(before, (batch) => selected(batch, false), current, 'select');
      const applied = cleared && await batches(ids, (batch) => selected(batch, true), current, 'select');
      if (!applied) {
        await batches(ids, (batch) => selected(batch, false), undefined, 'restore');
        if (!discardSelection) await batches(before, (batch) => { if (!discardSelection) selected(batch, true); }, undefined, 'restore');
        onProgress({ phase: 'cancelled' });
        return null;
      }
      onSelect?.(ids.length ? { identifiers: ids.slice(0, 1), modelVersionId: result.modelId } : null, current);
      scene.render?.(true);
      onProgress({ phase: 'done', processed: ids.length, total: ids.length });
      return { count: ids.length };
    });
  }
  function clear({ authorityChange = false } = {}) {
    cancel({ authorityChange });
    return enqueue(async (current) => {
      onStart?.();
      if (baseline) await restore(baseline);
      baseline = null;
      result = null;
      onSelect?.(null, current);
      onProgress({ phase: 'cleared', processed: 0, total: 0 });
    });
  }
  return {
    run, selectAll, clear, cancel, isBusy: () => pending > 0,
    getRevision: () => revision, settled: () => queue,
    destroy() { disposed = true; cancel({ authorityChange: true }); },
  };
}
