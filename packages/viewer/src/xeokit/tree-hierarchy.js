// SPDX-License-Identifier: AGPL-3.0-only

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
        return;
      }
      storeysByLabel.set(key, {
        displayName: String(displayName || modelId).trim().slice(0, 200),
        modelId: normalizedModelId,
        objectIds: new Set([objectId]),
        label,
      });
    });
  });
  return Array.from(storeysByLabel.values()).map((storey) => Object.freeze({
    ...storey,
    objectId: Array.from(storey.objectIds)[0],
    objectIds: Object.freeze(Array.from(storey.objectIds).sort()),
  })).sort((left, right) => (
    left.displayName.localeCompare(right.displayName) || left.label.localeCompare(right.label)
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
