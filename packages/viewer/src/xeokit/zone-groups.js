// SPDX-License-Identifier: AGPL-3.0-only

const MAX_GROUPS = 1000;
const MAX_IDENTIFIERS = 500_000;
const text = (value, limit) => typeof value === "string" && value.length > 0
  && value.length <= limit && !/[\u0000-\u001f]/.test(value);

// Optional presentation metadata. An older producer or invalid extension must
// never widen geometry authority or prevent an otherwise valid model opening.
export function normalizeZoneGroups(groups, scope) {
  if (!Array.isArray(groups) || groups.length > MAX_GROUPS) return null;
  if (!["all", "allowlist"].includes(scope?.mode)) return null;
  const allowed = scope.mode === "allowlist" ? new Set(scope.allowedObjectIds || []) : null;
  const keys = new Set();
  let total = 0;
  const result = [];
  for (const group of groups) {
    if (!text(group?.id, 128) || keys.has(group.id) || !text(group.code, 200)
      || !text(group.name, 300) || !Array.isArray(group.objectIds)) return null;
    keys.add(group.id);
    total += group.objectIds.length;
    if (total > MAX_IDENTIFIERS || group.objectIds.some((id) => !text(id, 128) || id.includes("#"))) return null;
    const objectIds = [...new Set(group.objectIds)].filter((id) => !allowed || allowed.has(id));
    if (objectIds.length) result.push(Object.freeze({
      id: group.id, code: group.code, name: group.name, objectIds: Object.freeze(objectIds),
    }));
  }
  return Object.freeze(result);
}

function storeyFor(meta, metaObjects, cache) {
  const visited = new Set();
  const trail = [];
  let current = meta;
  let storey = null;
  while (current && !visited.has(current)) {
    if (cache.has(current)) { storey = cache.get(current); break; }
    trail.push(current);
    if (current.type === "IfcBuildingStorey") { storey = current; break; }
    visited.add(current);
    current = typeof current.parent === "string" ? metaObjects[current.parent] : current.parent;
  }
  trail.forEach((entry) => cache.set(entry, storey));
  return storey;
}

// The model prefix is essential: IFC GUIDs may recur in different versions.
export function buildZoneTreeGroups(viewer, models, unknownStorey = "—") {
  const result = [];
  const metadata = viewer?.metaScene?.metaObjects || {};
  const storeyCache = new Map();
  for (const model of models) {
    for (const zone of model.zoneGroups || []) {
      const objectIds = zone.objectIds.map((id) => `${model.modelId}#${id}`)
        .filter((id) => viewer.scene?.objects?.[id]);
      if (!objectIds.length) continue;
      const storeys = new Map();
      for (const id of objectIds) {
        const meta = metadata[id];
        const storey = storeyFor(meta, metadata, storeyCache);
        const key = String(storey?.id || "");
        const entry = storeys.get(key) || { label: storey?.name || unknownStorey, objectIds: [], types: new Map() };
        entry.objectIds.push(id);
        const type = String(meta?.type || "IfcElement");
        const ids = entry.types.get(type) || [];
        ids.push(id);
        entry.types.set(type, ids);
        storeys.set(key, entry);
      }
      result.push({ modelId: model.modelId, displayName: model.displayName, ...zone, objectIds,
        storeys: [...storeys.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
      });
    }
  }
  return result;
}
