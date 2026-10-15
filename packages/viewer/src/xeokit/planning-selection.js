// SPDX-License-Identifier: AGPL-3.0-only
import { validatePlanningSelectionPayload } from '../../../protocol/src/index.js';
// Stage a bounded model-scoped set; never show partial planning selections.
export function createPlanningSelection({ model, viewer, selection, timeoutMs = 60000 }) {
  let pending = null;
  let timer = null;
  const reset = () => { clearTimeout(timer); timer = null; pending = null; };
  const fingerprint = () => JSON.stringify(model.listDescriptors());
  const touch = () => { clearTimeout(timer); timer = setTimeout(reset, timeoutMs); timer.unref?.(); };
  function request(payload) {
    try {
      if (!validatePlanningSelectionPayload(payload).ok) throw new Error('Planning selection payload is invalid.');
      const { action, operationId, modelVersionId } = payload;
      if (action === 'cancel') {
        if (pending?.operationId === operationId) reset();
        return;
      }
      if (action === 'begin') {
        reset();
        if (!model.listDescriptors().some((entry) => entry.modelId === modelVersionId)) {
          throw new Error('Planning model is not loaded.');
        }
        pending = { operationId, modelVersionId, total: payload.total, ids: [], unique: new Set(), fingerprint: fingerprint(), selectionRevision: selection.getRevision() };
        touch();
        return;
      }
      if (!pending || pending.operationId !== operationId || pending.modelVersionId !== modelVersionId
          || pending.fingerprint !== fingerprint() || pending.selectionRevision !== selection.getRevision()) {
        throw new Error('Planning selection context changed or expired.');
      }
      if (action === 'append') {
        if (payload.offset !== pending.ids.length || pending.ids.length + payload.globalIds.length > pending.total
            || payload.globalIds.some((id) => pending.unique.has(id))) throw new Error('Planning selection page is inconsistent.');
        payload.globalIds.forEach((id) => { pending.ids.push(id); pending.unique.add(id); });
        touch();
        return;
      }
      if (action !== 'commit' || pending.ids.length !== pending.total) throw new Error('Planning selection is incomplete.');
      const ids = pending.ids.map((guid) => `${modelVersionId}#${guid}`);
      if (ids.some((id) => !viewer.scene.objects[id] || model.modelVersionIdFor(id) !== modelVersionId
          || !model.isObjectAllowed(id))) throw new Error('Planning objects are unavailable or no longer authorized.');
      reset();
      const selected = selection.select(ids);
      if (!Array.isArray(selected) || selected.length !== ids.length || selected.some((id, i) => id !== ids[i])) {
        selection.clear({ authorityChange: true });
        throw new Error('Planning selection was not applied completely.');
      }
    } catch (error) { reset(); throw error; }
  }
  return Object.freeze({ request, reset, destroy: reset });
}
