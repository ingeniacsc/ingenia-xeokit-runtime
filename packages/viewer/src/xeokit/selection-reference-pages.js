// SPDX-License-Identifier: AGPL-3.0-only

const PAGE_SIZE = 50;
const MAX_OBJECTS = 100_000;
const SNAPSHOT_TTL_MS = 120_000;
const opaque = (value) => typeof value === 'string' && /^[A-Za-z0-9._~-]{16,128}$/.test(value);
const reference = (value) => typeof value === 'string'
  && /^selection\.session\.[A-Za-z0-9._~-]{16,110}$/.test(value);

function failure(code, message) {
  const error = new Error(message);
  error.protocolCode = `SELECTION_EXPORT_${code}`;
  return error;
}

// Export-only references never enter the interaction registry: refreshing that
// registry would retire the context-menu seed used by subsequent toolbar actions.
export function createSelectionReferencePages({
  getObjectIds,
  getRevision,
  isObjectAllowed,
  modelVersionIdFor,
  createReferences,
  now = Date.now,
  createSnapshotId = () => globalThis.crypto.randomUUID(),
}) {
  let snapshot = null;
  let pending = false;
  let destroyed = false;

  const validateCurrent = (candidate) => {
    const elapsed = now() - candidate.createdAt;
    if (destroyed || snapshot !== candidate || !Number.isFinite(elapsed)
        || elapsed < 0 || elapsed >= SNAPSHOT_TTL_MS || getRevision() !== candidate.revision) {
      throw failure('STALE', 'The selected objects changed or the export expired.');
    }
    const current = getObjectIds();
    if (!Array.isArray(current) || current.length !== candidate.objectIds.length
        || current.some((id, index) => id !== candidate.objectIds[index])) {
      throw failure('STALE', 'The selected objects changed during export.');
    }
    if (current.some((id) => isObjectAllowed(id) !== true
        || modelVersionIdFor(id) !== candidate.modelVersionId)) {
      throw failure('DENIED', 'The selected objects are no longer available for export.');
    }
  };

  return Object.freeze({
    async request(payload) {
      if (destroyed) throw failure('STALE', 'The Viewer export session ended.');
      if (pending) throw failure('BUSY', 'A selection export page is already pending.');
      if (!payload || Object.keys(payload).some((key) => !['offset', 'snapshotId'].includes(key))
          || !Number.isSafeInteger(payload.offset) || payload.offset < 0 || payload.offset > MAX_OBJECTS
          || (payload.snapshotId !== undefined && !opaque(payload.snapshotId))) {
        throw failure('INVALID', 'The selection export page request is invalid.');
      }
      if (payload.snapshotId === undefined) {
        if (payload.offset !== 0) throw failure('INVALID', 'A selection export must start at the first page.');
        const objectIds = getObjectIds();
        if (!Array.isArray(objectIds) || !objectIds.length) {
          throw failure('EMPTY', 'Select objects before exporting.');
        }
        if (objectIds.length > MAX_OBJECTS) {
          throw failure('LIMIT', 'The selection exceeds the export limit of 100000 objects.');
        }
        if (objectIds.some((id) => typeof id !== 'string' || !id) || new Set(objectIds).size !== objectIds.length) {
          throw failure('INVALID', 'The selection contains invalid or duplicate objects.');
        }
        const modelVersionId = modelVersionIdFor(objectIds[0]);
        const snapshotId = createSnapshotId();
        if (!opaque(modelVersionId) || !opaque(snapshotId)) {
          throw failure('INVALID', 'The selection model or export identity is invalid.');
        }
        snapshot = { snapshotId, modelVersionId, objectIds: [...objectIds],
          revision: getRevision(), createdAt: now(), nextOffset: 0, usedReferences: new Set() };
      }
      const candidate = snapshot;
      if (!candidate || (payload.snapshotId !== undefined && payload.snapshotId !== candidate.snapshotId)
          || payload.offset !== candidate.nextOffset) {
        throw failure('STALE', 'The selection export page is no longer current.');
      }
      pending = true;
      try {
        validateCurrent(candidate);
        const page = candidate.objectIds.slice(payload.offset, payload.offset + PAGE_SIZE);
        // An empty terminal page revalidates after the host resolved all prior
        // pages, without issuing another network request or changing selection.
        const identifiers = page.length ? await createReferences(page) : [];
        validateCurrent(candidate);
        if (!Array.isArray(identifiers) || identifiers.length !== page.length
            || identifiers.some((id) => !reference(id) || candidate.usedReferences.has(id))
            || new Set(identifiers).size !== identifiers.length) {
          throw failure('INVALID', 'The selection reference response is invalid.');
        }
        identifiers.forEach((id) => candidate.usedReferences.add(id));
        candidate.nextOffset = payload.offset + page.length;
        return { snapshotId: candidate.snapshotId, modelVersionId: candidate.modelVersionId,
          identifiers: [...identifiers], offset: payload.offset, total: candidate.objectIds.length,
          done: candidate.nextOffset === candidate.objectIds.length };
      } catch (error) {
        if (snapshot === candidate) snapshot = null;
        if (error?.protocolCode?.startsWith('SELECTION_EXPORT_')) throw error;
        // A backend failure may contain private URLs or raw object IDs.
        throw failure('DENIED', 'Selection references could not be authorized.');
      } finally {
        pending = false;
      }
    },
    destroy() {
      destroyed = true;
      snapshot = null;
    },
  });
}
