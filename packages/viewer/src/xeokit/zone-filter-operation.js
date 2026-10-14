// SPDX-License-Identifier: AGPL-3.0-only
const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

// All geometry stays in the iframe. Only a bounded selection seed is published.
// Jobs are serialized so cancelling/replacing a filter restores its snapshot
// before the next filter begins, including after a model/authority change.
export function createZoneFilterOperation(viewer, {
  filterAllowedObjectIds = (ids) => ids, onSelect, onStart, onProgress = () => {},
  yieldFrame = yieldToBrowser, batchSize = 256,
} = {}) {
  let active = null;
  let serial = 0;
  let queue = Promise.resolve();
  let disposed = false;
  let pending = 0;
  const existing = (ids) => ids.filter((id) => viewer.scene.objects?.[id]);
  const allowed = (ids) => filterAllowedObjectIds(existing(ids));
  async function batches(ids, apply, job, phase) {
    for (let i = 0; i < ids.length; i += batchSize) {
      if (job?.cancelled) return false;
      apply(ids.slice(i, i + batchSize));
      if (job) onProgress({ phase, processed: Math.min(ids.length, i + batchSize), total: ids.length });
      await yieldFrame();
    }
    return !job?.cancelled;
  }
  const visible = (ids, value) => viewer.scene.setObjectsVisible?.(value ? allowed(ids) : existing(ids), value);
  const selected = (ids, value) => viewer.scene.setObjectsSelected?.(value ? allowed(ids) : existing(ids), value);
  async function restore(snapshot) {
    await batches(snapshot.all, (ids) => { visible(ids, false); selected(ids, false); });
    await batches(snapshot.visible, (ids) => visible(ids, true));
    await batches(snapshot.selected, (ids) => { if (!snapshot.discardSelection) selected(ids, true); });
  }
  function cancel({ discardSelection = false } = {}) {
    serial += 1;
    if (active) {
      active.cancelled = true;
      if (discardSelection && active.snapshot) {
        active.snapshot.discardSelection = true;
        active.snapshot.selected = [];
      }
    }
  }
  function run(ids, { reset = false } = {}) {
    cancel();
    const revision = serial;
    pending += 1;
    queue = queue.catch(() => {}).then(async () => {
      if (disposed || revision !== serial) { pending -= 1; return false; }
      const job = { cancelled: false };
      active = job;
      const all = [...(viewer.scene.objectIds || [])];
      const snapshot = {
        all,
        visible: all.filter((id) => viewer.scene.objects[id]?.visible !== false),
        selected: [...(viewer.scene.selectedObjectIds || [])],
      };
      job.snapshot = snapshot;
      const targets = allowed([...new Set(reset ? all : ids)]);
      try {
        onStart?.();
        const hidden = await batches(all, (batch) => { visible(batch, false); selected(batch, false); }, job, "prepare");
        const applied = hidden && await batches(targets, (batch) => {
          visible(batch, true);
          if (!reset) selected(batch, true);
        }, job, "apply");
        if (!applied || disposed) {
          await restore(snapshot);
          onProgress({ phase: "cancelled", processed: 0, total: targets.length });
          return false;
        }
        if (!reset && targets.length) {
          const aabb = viewer.scene.getAABB?.(targets);
          if (aabb) viewer.cameraFlight?.flyTo?.({ aabb, fit: true, duration: 0.6 });
        }
        // Tree rows are attributed to a single version; no raw bulk identifiers
        // or customer metadata travel in a protocol message.
        onSelect?.(reset || !targets.length ? null : {
          identifiers: targets.slice(0, 1), modelVersionId: targets[0].split("#", 1)[0],
        }, () => !disposed && revision === serial);
        viewer.scene.render?.(true);
        onProgress({ phase: "done", processed: targets.length, total: targets.length });
        return true;
      } catch (error) {
        await restore(snapshot);
        onProgress({ phase: "error", processed: 0, total: targets.length });
        throw error;
      } finally { pending -= 1; if (active === job) active = null; }
    });
    return queue;
  }
  return { run, cancel, isBusy: () => pending > 0, getRevision: () => serial,
    destroy() { disposed = true; cancel(); }, settled: () => queue };
}
