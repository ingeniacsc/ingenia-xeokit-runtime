// SPDX-License-Identifier: AGPL-3.0-only

const naturalOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function storeyElevation(metaObject) {
  const value = metaObject?.attributes?.elevation ?? metaObject?.attributes?.Elevation;
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compareStoreys(left, right) {
  const leftKnown = Number.isFinite(left.elevation);
  const rightKnown = Number.isFinite(right.elevation);
  if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
  return (leftKnown ? left.elevation - right.elevation : 0)
    || naturalOrder.compare(left.label, right.label);
}

export function createTreeNodeComparator(viewer) {
  return (left, right) => {
    const leftMeta = viewer?.metaScene?.metaObjects?.[left.objectId];
    const rightMeta = viewer?.metaScene?.metaObjects?.[right.objectId];
    const leftStorey = (left.type || leftMeta?.type) === 'IfcBuildingStorey';
    const rightStorey = (right.type || rightMeta?.type) === 'IfcBuildingStorey';
    if (leftStorey !== rightStorey) return leftStorey ? -1 : 1;
    if (leftStorey) return compareStoreys(
      { elevation: storeyElevation(leftMeta), label: left.title || '' },
      { elevation: storeyElevation(rightMeta), label: right.title || '' },
    );
    return naturalOrder.compare(left.title || '', right.title || '');
  };
}

export function supportsModelTreeHierarchy(metaModel, hierarchy) {
  if (hierarchy !== "storeys") return true;
  let foundBuilding = false;
  let invalidStorey = false;
  const visit = (metaObject, insideBuilding = false) => {
    if (!metaObject || invalidStorey) return;
    const isBuilding = metaObject.type === "IfcBuilding";
    const withinBuilding = insideBuilding || isBuilding;
    if (isBuilding) foundBuilding = true;
    if (metaObject.type === "IfcBuildingStorey" && !withinBuilding) {
      invalidStorey = true;
      return;
    }
    (metaObject.children || []).forEach((child) => visit(child, withinBuilding));
  };
  (metaModel?.rootMetaObjects || []).forEach((root) => visit(root));
  return foundBuilding && !invalidStorey;
}

export function resolveModelStoreys(viewer, modelEntries = []) {
  const storeysByLabel = new Map();
  modelEntries.forEach(({ modelId, displayName }) => {
    const metaModel = viewer?.metaScene?.metaModels?.[modelId];
    if (!metaModel?.finalized) return;
    Object.values(metaModel.metaObjects || {}).forEach((metaObject) => {
      if (metaObject?.type !== "IfcBuildingStorey") return;
      const objectId = String(metaObject.id || "").trim();
      const label = String(metaObject.name || metaObject.objectType || objectId).trim().slice(0, 200);
      if (!objectId || !label) return;
      const normalizedModelId = String(modelId);
      const normalizedLabel = label.normalize("NFKC").toLocaleLowerCase();
      const key = `${normalizedModelId}\u0000${normalizedLabel}`;
      const existing = storeysByLabel.get(key);
      if (existing) {
        existing.objectIds.add(objectId);
        if (existing.elevation !== storeyElevation(metaObject)) existing.elevation = null;
        return;
      }
      storeysByLabel.set(key, {
        displayName: String(displayName || modelId).trim().slice(0, 200),
        modelId: normalizedModelId,
        objectIds: new Set([objectId]),
        label,
        elevation: storeyElevation(metaObject),
      });
    });
  });
  return Array.from(storeysByLabel.values()).map((storey) => Object.freeze({
    ...storey,
    objectId: Array.from(storey.objectIds)[0],
    objectIds: Object.freeze(Array.from(storey.objectIds).sort()),
  })).sort((left, right) => (
    naturalOrder.compare(left.displayName, right.displayName)
    || naturalOrder.compare(left.modelId, right.modelId) || compareStoreys(left, right)
  ));
}

export function populateModelTree({ viewer, plugin, modelEntries, hierarchy, body, emptyMessage }) {
  let supportedModelCount = 0;
  modelEntries.forEach(({ modelId, displayName }) => {
    const metaModel = viewer?.metaScene?.metaModels?.[modelId];
    if (metaModel?.finalized && supportsModelTreeHierarchy(metaModel, hierarchy)) {
      supportedModelCount += 1;
      plugin.addModel?.(modelId, { rootName: displayName || modelId });
    }
  });
  if (hierarchy !== "storeys" || supportedModelCount > 0) return;
  const emptyState = document.createElement("p");
  emptyState.className = "ingenia-model-tree-search-status";
  emptyState.dataset.treeEmpty = "true";
  emptyState.setAttribute("role", "status");
  emptyState.textContent = emptyMessage || "Mô hình chưa có dữ liệu IfcBuilding để phân tầng.";
  body.appendChild(emptyState);
}
