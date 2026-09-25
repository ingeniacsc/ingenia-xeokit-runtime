// SPDX-License-Identifier: AGPL-3.0-only
// Never resolve a bare GUID against the entire scene: revisions share GUIDs.
export async function selectVersionObjects({ viewer, model, selection, camera }, payload) {
  const { modelId, globalIds, fit = false } = payload;
  if (!/^[A-Za-z0-9._~-]{16,128}$/.test(modelId || '')
    || !Array.isArray(globalIds) || globalIds.length < 1 || globalIds.length > 50
    || new Set(globalIds).size !== globalIds.length
    || globalIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_$]{1,128}$/.test(id))
    || typeof fit !== 'boolean') throw new Error('Invalid version selection.');
  const objectIds = globalIds.map((guid) => `${modelId}#${guid}`);
  const allowed = () => model.list().includes(modelId) && objectIds.every((id) =>
    Boolean(viewer.scene.objects[id]) && model.modelVersionIdFor(id) === modelId && model.isObjectAllowed(id));
  if (!allowed()) throw new Error('Requested objects are unavailable in the authorized model.');
  // Existing publisher obtains fresh opaque references from the capability API.
  await selection.selectAuthorized(objectIds);
  if (!allowed()) { selection.clear(); throw new Error('Model authority changed during selection.'); }
  if (fit) camera.fit(objectIds);
  return objectIds;
}
