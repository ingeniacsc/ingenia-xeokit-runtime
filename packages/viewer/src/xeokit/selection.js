// SPDX-License-Identifier: AGPL-3.0-only

import { resolveTechnicalMatchValue } from './object-properties.js';
import { createMarqueeGesture, createMarqueeIntersection } from './marquee-selection.js';
const MATCH_SCOPES = new Set(['exact', 'type', 'system', 'material', 'tag', 'storey']);
const MATCH_SCAN_CHUNK = 100;
const MAX_PUBLIC_SELECTION_REFERENCES = 50;
const MAX_MATCH_CACHE_BYTES = 256 * 1024;
const MAX_MATCH_WORK_UNITS = 250_000;
const TOUCH_PICK_MAX_DISTANCE_PX = 12;
const TOUCH_PICK_CLICK_DEDUPLICATION_MS = 750;

function normalizeValue(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function resolveMetaObject(viewer, objectId) {
  return viewer.metaScene?.metaObjects?.[objectId] || null;
}

function resolveStorey(viewer, objectId) {
  let metaObject = resolveMetaObject(viewer, objectId);
  for (let depth = 0; metaObject && depth < 32; depth += 1) {
    if (metaObject.type === 'IfcBuildingStorey') return normalizeValue(metaObject.name || metaObject.id);
    const parent = metaObject.parent;
    metaObject = typeof parent === 'string' ? resolveMetaObject(viewer, parent) : parent || null;
  }
  return '';
}

function resolveMatchValue(viewer, objectId, scope, workBudget) {
  if (scope === 'storey') return resolveStorey(viewer, objectId);
  return resolveTechnicalMatchValue(viewer, objectId, scope, workBudget);
}

function selectObjects(viewer, identifiers, onSelectionAppearanceChanged) {
  const uniqueIdentifiers = Array.from(new Set(identifiers.filter(Boolean)));
  viewer.scene.setObjectsSelected(viewer.scene.selectedObjectIds, false);
  viewer.scene.setObjectsSelected(uniqueIdentifiers, true);
  onSelectionAppearanceChanged?.();
  return uniqueIdentifiers;
}

function toggleObjectSelectionCandidates(viewer, objectId, modelVersionId) {
  const currentSelection = new Set(
    (viewer.scene.selectedObjectIds || []).filter(
      (identifier) => !modelVersionId || resolveModelVersionId(identifier) === modelVersionId,
    ),
  );
  if (currentSelection.has(objectId)) {
    currentSelection.delete(objectId);
  } else {
    currentSelection.add(objectId);
  }
  return Array.from(currentSelection);
}

function resolveModelVersionId(objectId) {
  const normalized = String(objectId || '');
  const separatorIndex = normalized.indexOf('#');
  return separatorIndex > 0 ? normalized.slice(0, separatorIndex) : '';
}

function isEditableKeyboardTarget(target) {
  if (!target || typeof target !== 'object') return false;
  if (target.isContentEditable === true) return true;
  return ['INPUT', 'SELECT', 'TEXTAREA'].includes(String(target.tagName || '').toUpperCase());
}

export function createSelectionController(
  viewer,
  onPicked,
  onContextMenu,
  {
    isInteractionCaptured,
    keyboardTarget = typeof window !== 'undefined' ? window : null,
    matchWorkUnitLimit = MAX_MATCH_WORK_UNITS,
    onSelectionOperationCancelled,
    onSelectionOperationComplete,
    onSelectionOperationProgress,
    onSelectionSeedVerification = onPicked,
    onSelectionCleared,
    onSelectionDetails,
    onSelectionAppearanceChanged,
    onOrbitPivot,
    resolveTechnicalPropertyAccess,
  } = {},
) {
  let multiSelectMode = false;
  let authorityRevision = 0;
  let matchValueCacheBytes = 0;
  const matchValueCache = new Map();
  let touchPointerStart = null;
  let lastTouchPick = null;
  let marquee = null;
  let marqueeOperation = null;
  const canvas = viewer.scene.canvas.canvas;
  const clearSelection = () => {
    marquee?.cancel();
    authorityRevision += 1;
    marqueeOperation = null;
    onSelectionOperationCancelled?.();
    viewer.scene.setObjectsSelected(viewer.scene.selectedObjectIds, false);
    onSelectionAppearanceChanged?.();
    onSelectionDetails?.({ identifiers: [], scope: 'selection' });
    onSelectionCleared?.();
  };
  const pickObject = (event) => {
    const rect = canvas.getBoundingClientRect();
    return viewer.scene.pick({ canvasPos: [event.clientX - rect.left, event.clientY - rect.top] })?.entity?.id || '';
  };
  const authorizeAndSelect = async (
    payload,
    publisher = onPicked,
    operationRevision = null,
    publishDetails = true,
    applySelection = true,
  ) => {
    const requestRevision = operationRevision ?? ++authorityRevision;
    const { authorizationIdentifiers, scope, totalAvailable, ...publicPayload } = payload;
    const isCurrent = () => requestRevision === authorityRevision;
    const publication = publisher?.({
      ...publicPayload,
      identifiers: authorizationIdentifiers || publicPayload.identifiers,
    }, isCurrent);
    const publicationResult = publication && typeof publication.then === 'function'
      ? await publication
      : publication;
    if (publicationResult === null || !isCurrent()) return Array.from(viewer.scene.selectedObjectIds || []);
    // Opening a context menu verifies its seed with the host, but must never
    // collapse an already-selected local group to the bounded public payload.
    const selected = applySelection
      ? selectObjects(viewer, payload.identifiers, onSelectionAppearanceChanged)
      : Array.from(viewer.scene.selectedObjectIds || []);
    if (publishDetails) {
      onSelectionDetails?.({
        identifiers: selected,
        scope: scope || (selected.length === 1 ? 'single' : 'selection'),
        totalAvailable,
      });
    }
    return selected;
  };
  const cachedMatchValue = (objectId, scope, workBudget) => {
    const key = `${scope}:${objectId}`;
    if (!matchValueCache.has(key)) {
      const value = resolveMatchValue(viewer, objectId, scope, workBudget);
      if (value) {
        const entryBytes = (key.length + value.length) * 2;
        if (entryBytes > MAX_MATCH_CACHE_BYTES) return value;
        if (matchValueCacheBytes + entryBytes > MAX_MATCH_CACHE_BYTES) {
          matchValueCache.clear();
          matchValueCacheBytes = 0;
        }
        matchValueCache.set(key, value);
        matchValueCacheBytes += entryBytes;
      }
      return value;
    }
    return matchValueCache.get(key);
  };
  const invalidateModel = (modelId) => {
    marquee?.cancel();
    authorityRevision += 1;
    marqueeOperation = null;
    onSelectionOperationCancelled?.();
    const normalizedModelId = String(modelId || '').trim();
    if (!normalizedModelId) return;
    const prefix = `${normalizedModelId}#`;
    for (const [key, value] of matchValueCache) {
      const objectId = key.slice(key.indexOf(':') + 1);
      if (!objectId.startsWith(prefix)) continue;
      matchValueCacheBytes -= (key.length + value.length) * 2;
      matchValueCache.delete(key);
    }
    matchValueCacheBytes = Math.max(0, matchValueCacheBytes);
  };
  const canMatchScope = (objectId, scope) => {
    if (typeof resolveTechnicalPropertyAccess !== 'function') return true;
    const access = resolveTechnicalPropertyAccess(objectId) || {};
    if (scope === 'type') return access.ifcType === true;
    if (scope === 'storey') return access.storey === true;
    return access.propertySets === true;
  };
  const selectAuthorizedVisibleGeometry = async ({
    expected = '',
    modelVersionId,
    matchMode = 'all',
    primaryObjectId,
    scope,
    workBudget = null,
  }) => {
    const operationRevision = ++authorityRevision;
    const entities = Object.values(viewer.scene.objects || {});
    const matches = [];
    onSelectionOperationProgress?.({ scope, processed: 0, total: entities.length, matched: 0 });
    for (let index = 0; index < entities.length; index += 1) {
      if (workBudget && !workBudget.consume()) break;
      const entity = entities[index];
      if (entity
          && entity.visible !== false
          && (!modelVersionId || resolveModelVersionId(entity.id) === modelVersionId)
          && (matchMode === 'all'
            || (matchMode === 'expected' && cachedMatchValue(entity.id, scope, workBudget) === expected)
            || (matchMode === 'primary' && entity.id === primaryObjectId))) {
        matches.push(entity.id);
      }
      if ((index + 1) % MATCH_SCAN_CHUNK === 0 || index + 1 === entities.length) {
        onSelectionOperationProgress?.({
          scope,
          processed: index + 1,
          total: entities.length,
          matched: matches.length,
        });
        await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
        if (operationRevision !== authorityRevision) {
          onSelectionOperationCancelled?.();
          return Array.from(viewer.scene.selectedObjectIds || []);
        }
      }
    }
    if (workBudget?.exhausted) {
      throw new Error('Technical selection exceeded the safe work limit.');
    }
    const selected = await authorizeAndSelect({
      identifiers: matches,
      // The host authorizes only the seed object; bulk geometry stays private.
      authorizationIdentifiers: [primaryObjectId],
      ...(modelVersionId ? { modelVersionId } : {}),
      scope,
      totalAvailable: matches.length,
    }, onSelectionSeedVerification, operationRevision, false);
    if (operationRevision === authorityRevision) {
      onSelectionOperationComplete?.({ scope, selectedCount: selected.length });
    }
    return selected;
  };
  const pick = (event) => {
    if (isInteractionCaptured?.()) return;
    onOrbitPivot?.(event);
    const objectId = pickObject(event);
    if (!objectId) return;
    const modelVersionId = resolveModelVersionId(objectId);
    const modelSelection = Array.from(viewer.scene.selectedObjectIds || []).filter(
      (identifier) => !modelVersionId || resolveModelVersionId(identifier) === modelVersionId,
    );
    const hasSelection = modelSelection.includes(objectId);
    const removeFromSelection = event.shiftKey === true;
    const addToSelection = !removeFromSelection && (event.ctrlKey === true || event.metaKey === true);
    if (removeFromSelection && !hasSelection) return;
    if (addToSelection && hasSelection) return;
    const identifiers = removeFromSelection
      ? modelSelection.filter((identifier) => identifier !== objectId)
      : (addToSelection
        ? [...modelSelection, objectId]
        : (multiSelectMode
          ? toggleObjectSelectionCandidates(viewer, objectId, modelVersionId)
          : [objectId]));
    if (identifiers.length === 0) {
      clearSelection();
      return;
    }
    void authorizeAndSelect({
      identifiers,
      ...(identifiers.length > MAX_PUBLIC_SELECTION_REFERENCES
        ? { authorizationIdentifiers: [identifiers[0]] }
        : {}),
      scope: identifiers.length === 1 ? 'single' : 'selection',
      ...(modelVersionId ? { modelVersionId } : {}),
    }).catch(() => {});
  };
  const selectMarquee = async (rectangle, startEvent) => {
    const revision = ++authorityRevision;
    marqueeOperation = revision;
    const isCurrent = () => authorityRevision === revision;
    const intersects = createMarqueeIntersection(viewer.scene, rectangle);
    // Keep the established single-version attribution contract. Starting over
    // geometry chooses its version; starting on empty canvas chooses the first hit.
    const startId = pickObject(startEvent);
    let modelVersionId = resolveModelVersionId(startId);
    let primaryObjectId = '';
    const matches = [];
    const entities = Object.values(viewer.scene.objects || {});
    try {
      for (let index = 0; index < entities.length; index += 1) {
        const entity = entities[index];
        if (intersects(entity)
            && (!modelVersionId || resolveModelVersionId(entity.id) === modelVersionId)) {
          if (!primaryObjectId) {
            primaryObjectId = entity.id;
            modelVersionId = resolveModelVersionId(entity.id);
          }
          matches.push(entity.id);
        }
        if ((index + 1) % MATCH_SCAN_CHUNK === 0 || index + 1 === entities.length) {
          onSelectionOperationProgress?.({ scope: 'selection', processed: index + 1,
            total: entities.length, matched: matches.length });
          await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
          if (!isCurrent()) return;
        }
      }
      if (!matches.length) {
        onSelectionOperationCancelled?.();
        return;
      }
      const candidates = Array.from(new Set([
        ...(viewer.scene.selectedObjectIds || []).filter((id) => (
          resolveModelVersionId(id) === modelVersionId && viewer.scene.objects[id]
            && viewer.scene.objects[id].visible !== false && viewer.scene.objects[id].pickable !== false
        )), ...matches,
      ]));
      // Bulk geometry remains private. Verify its seed before changing the scene.
      const publication = await onSelectionSeedVerification?.({ identifiers: [primaryObjectId],
        ...(modelVersionId ? { modelVersionId } : {}) }, isCurrent);
      if (!isCurrent()) return;
      if (publication === null) {
        onSelectionOperationCancelled?.();
        return;
      }
      const selected = selectObjects(viewer, candidates, onSelectionAppearanceChanged);
      onSelectionDetails?.({ identifiers: selected, scope: 'selection', totalAvailable: selected.length });
      onSelectionOperationComplete?.({ scope: 'selection', selectedCount: selected.length });
    } catch {
      if (isCurrent()) onSelectionOperationCancelled?.();
    } finally {
      if (marqueeOperation === revision) marqueeOperation = null;
    }
  };
  const openContextMenu = (event) => {
    event.preventDefault();
    // Measurement owns point picking, but never disables the object menu.
    const objectId = pickObject(event);
    if (!objectId) return;
    const currentSelection = Array.from(viewer.scene.selectedObjectIds || []).filter(Boolean);
    const modelVersionId = resolveModelVersionId(objectId);
    const modelSelection = modelVersionId
      ? currentSelection.filter((identifier) => resolveModelVersionId(identifier) === modelVersionId)
      : currentSelection;
    const identifiers = modelSelection.length > 1
      && modelSelection.length <= MAX_PUBLIC_SELECTION_REFERENCES
      && modelSelection.includes(objectId)
      ? modelSelection
      : [objectId];
    const preserveExistingSelection = modelSelection.length > 0
      && modelSelection.includes(objectId);
    const rect = canvas.getBoundingClientRect();
    const payload = {
      identifiers,
      anchor: {
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))),
      },
    };
    if (modelVersionId) payload.modelVersionId = modelVersionId;
    void authorizeAndSelect(
      payload,
      onContextMenu,
      null,
      false,
      !preserveExistingSelection,
    ).catch(() => {});
  };
  const clearOnEscape = (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || isEditableKeyboardTarget(event.target)) return;
    if (!viewer.scene.selectedObjectIds?.length && marqueeOperation === null) return;
    event.preventDefault?.();
    clearSelection();
  };
  const shouldIgnoreSyntheticTouchClick = (event) => {
    if (!lastTouchPick) return false;
    const elapsed = Date.now() - lastTouchPick.at;
    if (elapsed < 0 || elapsed > TOUCH_PICK_CLICK_DEDUPLICATION_MS) return false;
    const deltaX = Number(event.clientX) - lastTouchPick.x;
    const deltaY = Number(event.clientY) - lastTouchPick.y;
    return Math.hypot(deltaX, deltaY) <= TOUCH_PICK_MAX_DISTANCE_PX;
  };
  const onCanvasClick = (event) => {
    if (marquee?.consumeClick()) return;
    if (shouldIgnoreSyntheticTouchClick(event)) return;
    pick(event);
  };
  const onPointerDown = (event) => {
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      touchPointerStart = {
        id: event.pointerId,
        x: Number(event.clientX) || 0,
        y: Number(event.clientY) || 0,
      };
    }
  };
  const onPointerUp = (event) => {
    if (!touchPointerStart || touchPointerStart.id !== event.pointerId) return;
    const start = touchPointerStart;
    touchPointerStart = null;
    const x = Number(event.clientX) || 0;
    const y = Number(event.clientY) || 0;
    if (Math.hypot(x - start.x, y - start.y) > TOUCH_PICK_MAX_DISTANCE_PX) return;
    lastTouchPick = { at: Date.now(), x, y };
    pick(event);
  };
  const onPointerCancel = (event) => {
    if (touchPointerStart?.id === event.pointerId) touchPointerStart = null;
  };
  marquee = createMarqueeGesture(viewer, {
    keyboardTarget, isInteractionCaptured,
    onStart: () => {
      authorityRevision += 1;
      marqueeOperation = null;
      onSelectionOperationCancelled?.();
    },
    onCancel: () => {
      authorityRevision += 1;
      marqueeOperation = null;
      onSelectionOperationCancelled?.();
    },
    onSelect: (rectangle, event) => { void selectMarquee(rectangle, event); },
    onClick: pick,
  });
  canvas.addEventListener('click', onCanvasClick);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('contextmenu', openContextMenu);
  keyboardTarget?.addEventListener?.('keydown', clearOnEscape);
  return Object.freeze({
    getRevision() { return authorityRevision; },
    select(identifiers) {
      marquee?.cancel();
      authorityRevision += 1;
      onSelectionOperationCancelled?.();
      const selected = selectObjects(viewer, identifiers, onSelectionAppearanceChanged);
      onSelectionDetails?.({ identifiers: selected, scope: selected.length === 1 ? 'single' : 'selection' });
      return selected;
    },
    setMode(mode) {
      multiSelectMode = mode === 'multi';
      return multiSelectMode ? 'multi' : 'single';
    },
    selectVisible(identifiers) {
      const primaryObjectId = identifiers?.[0] || '';
      const modelVersionId = resolveModelVersionId(primaryObjectId);
      if (!primaryObjectId) return Promise.resolve([]);
      return selectAuthorizedVisibleGeometry({
        matchMode: 'all',
        modelVersionId,
        primaryObjectId,
        scope: 'visible',
      });
    },
    async match(identifiers, scope) {
      const primaryObjectId = identifiers[0] || '';
      if (!primaryObjectId || !MATCH_SCOPES.has(scope)) return [];
      if (!canMatchScope(primaryObjectId, scope)) {
        throw new Error('This technical selection scope is not authorized.');
      }
      const workBudget = {
        exhausted: false,
        remaining: Math.max(1, Math.min(MAX_MATCH_WORK_UNITS, Number(matchWorkUnitLimit) || 1)),
        consume(units = 1) {
          if (this.remaining < units) {
            this.exhausted = true;
            return false;
          }
          this.remaining -= units;
          return true;
        },
      };
      const modelVersionId = resolveModelVersionId(primaryObjectId);
      const expected = cachedMatchValue(primaryObjectId, scope, workBudget);
      return selectAuthorizedVisibleGeometry({
        expected,
        matchMode: expected ? 'expected' : 'primary',
        modelVersionId,
        primaryObjectId,
        scope,
        workBudget,
      });
    },
    clear() {
      clearSelection();
    },
    invalidateModel,
    destroy() {
      marquee?.destroy();
      marqueeOperation = null;
      authorityRevision += 1;
      matchValueCache.clear();
      matchValueCacheBytes = 0;
      touchPointerStart = null;
      lastTouchPick = null;
      canvas.removeEventListener('click', onCanvasClick);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('contextmenu', openContextMenu);
      keyboardTarget?.removeEventListener?.('keydown', clearOnEscape);
    },
  });
}
