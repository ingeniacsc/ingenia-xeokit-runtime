// SPDX-License-Identifier: AGPL-3.0-only
import { SectionPlanesPlugin } from "@xeokit/xeokit-sdk";
import { createSectionAxisLabels } from "./section-axis-labels.js";
import { resolveIfcType } from "./appearance.js";
import {
  buildIfcSpaceMembershipVolume,
  classifyVisibleObjectsBySpaceMembership,
} from "./space-clip-geometry.js";

const SPACE_MEMBERSHIP_STRATEGY = "space-footprint-membership";
const SPACE_CLIP_PREFIX = "space-clip:";
const SPACE_CLIP_FLOOR_ID = `${SPACE_CLIP_PREFIX}floor`;
const SPACE_CLIP_CEILING_ID = `${SPACE_CLIP_PREFIX}ceiling`;
const LEVEL_CLIP_PREFIX = "level-clip:";
const LEVEL_CLIP_FLOOR_ID = `${LEVEL_CLIP_PREFIX}floor`;
const LEVEL_CLIP_CEILING_ID = `${LEVEL_CLIP_PREFIX}ceiling`;
const LEVEL_REFERENCE_PREFIX = "level.session.";
const MAX_LEVEL_OPTIONS = 120;
const VERTICAL_AXIS = 1;
const METRES_PER_MILLIMETRE = 0.001;
const MAX_LEVEL_OFFSET_MM = 5000;

function modelIdForObject(objectId) {
  const separator = String(objectId || "").indexOf("#");
  return separator > 0 ? String(objectId).slice(0, separator) : "";
}

function renderedAabb(entity) {
  const aabb = Array.from(entity?.aabb || []);
  return aabb.length === 6 && aabb.every(Number.isFinite) && aabb[4] > aabb[1] ? aabb : null;
}

function resolveMetaObject(viewer, objectId) {
  return viewer.metaScene?.metaObjects?.[objectId] || null;
}

function resolveParentStoreyId(viewer, objectId) {
  let metaObject = resolveMetaObject(viewer, objectId);
  for (let depth = 0; metaObject && depth < 32; depth += 1) {
    if (metaObject.type === "IfcBuildingStorey") return String(metaObject.id || "");
    const parent = metaObject.parent;
    metaObject = typeof parent === "string" ? resolveMetaObject(viewer, parent) : parent || null;
  }
  return "";
}

function numericElevation(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(",", ".");
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLevelOffsetMm(value) {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < -MAX_LEVEL_OFFSET_MM || value > MAX_LEVEL_OFFSET_MM) return null;
  return value;
}

function explicitStoreyElevation(metaObject) {
  const candidates = [metaObject?.attributes, metaObject?.properties, metaObject?.propertySets];
  const visited = new Set();
  const read = (value, depth = 0) => {
    if (depth > 4 || value === null || value === undefined || visited.has(value)) return null;
    const direct = numericElevation(value);
    if (direct !== null) return direct;
    if (typeof value !== "object") return null;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const result = read(item, depth + 1);
        if (result !== null) return result;
      }
      return null;
    }
    const semanticName = String(value.name || value.key || value.label || "").replace(/[^a-z]/gi, "");
    if (/^(elevation|elevationwithflooring)$/i.test(semanticName)) {
      for (const key of ["value", "nominalValue", "valueString"]) {
        const result = read(value[key], depth + 1);
        if (result !== null) return result;
      }
    }
    for (const [key, nested] of Object.entries(value)) {
      if (/^(elevation|elevationwithflooring)$/i.test(String(key).replace(/[^a-z]/gi, ""))) {
        const result = read(nested, depth + 1);
        if (result !== null) return result;
      }
    }
    return null;
  };
  for (const candidate of candidates) {
    const elevation = read(candidate);
    if (elevation !== null) return elevation;
  }
  return null;
}

function resolveStoreyLevels(viewer) {
  const storeys = Object.values(viewer.metaScene?.metaObjects || {})
    .filter((metaObject) => metaObject?.type === "IfcBuildingStorey")
    .map((metaObject) => {
      const elevation = explicitStoreyElevation(metaObject);
      return {
        metaObject,
        metaObjectId: String(metaObject.id || ""),
        elevation,
        hasExplicitElevation: elevation !== null,
      };
    })
    .filter(({ metaObjectId }) => metaObjectId);
  const byStoreyId = new Map(storeys.map((storey) => [storey.metaObjectId, storey]));
  Object.values(viewer.scene?.objects || {}).forEach((entity) => {
    const storey = byStoreyId.get(resolveParentStoreyId(viewer, entity?.id));
    const aabb = renderedAabb(entity);
    if (!storey || !aabb || storey.hasExplicitElevation) return;
    storey.minimumRenderedElevation = storey.minimumRenderedElevation === undefined
      ? aabb[VERTICAL_AXIS]
      : Math.min(storey.minimumRenderedElevation, aabb[VERTICAL_AXIS]);
    storey.elevation = storey.minimumRenderedElevation;
  });
  return storeys
    .filter(({ elevation }) => Number.isFinite(elevation))
    .map(({ metaObject, metaObjectId, elevation }) => ({
      elevation,
      label: String(metaObject.name || metaObject.id || "").trim().slice(0, 160),
      metaObjectId,
    }))
    .filter(({ label }) => label)
    .sort((left, right) => left.elevation - right.elevation || left.label.localeCompare(right.label))
    .slice(0, MAX_LEVEL_OPTIONS);
}

export function createSpatialController(viewer, {
  axisLabelContainer,
  onLevelClipChanged,
  onLevelsChanged,
  onSpaceClipChanged,
  visibility,
} = {}) {
  const sectionPlanes = new SectionPlanesPlugin(viewer, { overviewVisible: false });
  const planes = new Map();
  const axisLabels = createSectionAxisLabels({ viewer, container: axisLabelContainer });
  let activeSpaceClip = null;
  let activeLevelClip = null;
  let levelOptionsByReference = new Map();
  let spaceFilterRevision = 0;

  function publishSpaceClip(payload) {
    onSpaceClipChanged?.(Object.freeze(payload));
  }

  function publishLevelClip(payload) {
    onLevelClipChanged?.(Object.freeze(payload));
  }

  function publishLevelOptions() {
    const levels = resolveStoreyLevels(viewer);
    levelOptionsByReference = new Map();
    const publicLevels = levels.map((level, index) => {
      const reference = `${LEVEL_REFERENCE_PREFIX}${String(index + 1).padStart(12, "0")}`;
      levelOptionsByReference.set(reference, level);
      return Object.freeze({ reference, label: level.label });
    });
    onLevelsChanged?.(Object.freeze({ levels: Object.freeze(publicLevels) }));
    return publicLevels;
  }

  function clearManualSection() {
    sectionPlanes.hideControl?.();
    const plane = planes.get("primary-section");
    plane?.destroy?.();
    planes.delete("primary-section");
    axisLabels.clear();
  }

  function clearSpaceClipPlanes() {
    Array.from(planes.entries()).forEach(([id, plane]) => {
      if (!id.startsWith(SPACE_CLIP_PREFIX)) return;
      plane?.destroy?.();
      planes.delete(id);
    });
  }

  function clearLevelClipPlanes() {
    Array.from(planes.entries()).forEach(([id, plane]) => {
      if (!id.startsWith(LEVEL_CLIP_PREFIX)) return;
      plane?.destroy?.();
      planes.delete(id);
    });
  }

  function createSpaceClipPlanes(volume) {
    [
      { id: SPACE_CLIP_FLOOR_ID, pos: [0, volume.floorElevation, 0], dir: [0, 1, 0] },
      { id: SPACE_CLIP_CEILING_ID, pos: [0, volume.ceilingElevation, 0], dir: [0, -1, 0] },
    ].forEach((descriptor) => {
      const plane = sectionPlanes.createSectionPlane({ ...descriptor, active: true });
      planes.set(descriptor.id, plane);
    });
  }

  function createLevelClipPlanes(lowerElevation, upperElevation) {
    [
      { id: LEVEL_CLIP_FLOOR_ID, pos: [0, lowerElevation, 0], dir: [0, 1, 0] },
      { id: LEVEL_CLIP_CEILING_ID, pos: [0, upperElevation, 0], dir: [0, -1, 0] },
    ].forEach((descriptor) => {
      const plane = sectionPlanes.createSectionPlane({ ...descriptor, active: true });
      planes.set(descriptor.id, plane);
    });
  }

  function clearActiveSpaceClip({ publish = true } = {}) {
    spaceFilterRevision += 1;
    clearSpaceClipPlanes();
    const transientHiddenIds = Array.from(activeSpaceClip?.hiddenObjectIds || []);
    if (transientHiddenIds.length > 0) visibility?.restoreTransient?.(transientHiddenIds);
    if (!activeSpaceClip) return false;
    activeSpaceClip = null;
    if (publish) publishSpaceClip({ status: "cleared" });
    return true;
  }

  function clearActiveLevelClip({ publish = true } = {}) {
    clearLevelClipPlanes();
    if (!activeLevelClip) return false;
    activeLevelClip = null;
    if (publish) publishLevelClip({ status: "cleared" });
    return true;
  }

  async function applySpaceMembershipFilter() {
    const current = activeSpaceClip;
    if (!current) return null;
    const revision = ++spaceFilterRevision;
    const classification = await classifyVisibleObjectsBySpaceMembership(viewer.scene, current.volume, {
      excludeObjectId: current.objectId,
      shouldContinue: () => activeSpaceClip === current && spaceFilterRevision === revision,
      onProgress: ({ scannedObjectCount, totalObjectCount }) => {
        if (activeSpaceClip === current && spaceFilterRevision === revision) {
          publishSpaceClip({
            status: "filtering",
            strategy: SPACE_MEMBERSHIP_STRATEGY,
            scannedObjectCount,
            totalObjectCount,
          });
        }
      },
    });
    if (classification.cancelled || activeSpaceClip !== current || spaceFilterRevision !== revision) return null;
    const newlyHiddenIds = visibility?.hideTransient?.(classification.hiddenObjectIds) || [];
    newlyHiddenIds.forEach((id) => current.hiddenObjectIds.add(id));
    viewer.scene.render(true);
    return classification;
  }

  return Object.freeze({
    setSection({ id = "primary-section", pos, dir = [0, -1, 0] }) {
      if (id === "primary-section") {
        clearActiveSpaceClip();
        clearActiveLevelClip();
      }
      sectionPlanes.hideControl?.();
      planes.get(id)?.destroy?.();
      const sceneAabb = viewer.scene.getAABB();
      const center = [
        (sceneAabb[0] + sceneAabb[3]) / 2,
        (sceneAabb[1] + sceneAabb[4]) / 2,
        (sceneAabb[2] + sceneAabb[5]) / 2,
      ];
      const plane = sectionPlanes.createSectionPlane({
        id,
        pos: pos || center,
        dir,
        active: true,
      });
      planes.set(id, plane);
      // Match the direct Xeokit viewer: the cut plane remains movable in canvas.
      sectionPlanes.showControl?.(plane.id);
      axisLabels.setSectionPlane(plane);
      viewer.scene.render(true);
    },
    clearSection({ id } = {}) {
      if (id) {
        sectionPlanes.hideControl?.();
        planes.get(id)?.destroy?.();
        planes.delete(id);
        if (id === "primary-section") axisLabels.clear();
      } else {
        clearManualSection();
        clearActiveSpaceClip();
        clearActiveLevelClip();
      }
      viewer.scene.render(true);
    },
    flipSection() {
      if (activeSpaceClip || activeLevelClip) return false;
      sectionPlanes.flipSectionPlanes?.();
      viewer.scene.render(true);
      return true;
    },
    async setSpaceClip() {
      const selectedObjectIds = Array.from(viewer.scene?.selectedObjectIds || []);
      if (selectedObjectIds.length === 0) {
        publishSpaceClip({ status: "rejected", reason: "NO_SELECTION" });
        return false;
      }
      if (selectedObjectIds.length !== 1) {
        publishSpaceClip({ status: "rejected", reason: "MULTIPLE_SELECTION" });
        return false;
      }
      const objectId = selectedObjectIds[0];
      const entity = viewer.scene?.objects?.[objectId];
      if (!entity) {
        publishSpaceClip({ status: "rejected", reason: "OBJECT_NOT_RENDERED" });
        return false;
      }
      if (resolveIfcType(viewer, entity) !== "IfcSpace") {
        publishSpaceClip({ status: "rejected", reason: "NOT_IFC_SPACE" });
        return false;
      }
      const volume = buildIfcSpaceMembershipVolume(entity);
      if (!volume.ok) {
        publishSpaceClip({ status: "rejected", reason: volume.reason });
        return false;
      }
      clearManualSection();
      clearActiveSpaceClip();
      clearActiveLevelClip();
      activeSpaceClip = {
        modelId: modelIdForObject(objectId),
        objectId,
        volume,
        hiddenObjectIds: new Set(),
      };
      try {
        createSpaceClipPlanes(volume);
      } catch {
        clearActiveSpaceClip({ publish: false });
        publishSpaceClip({ status: "rejected", reason: "SPACE_GEOMETRY_UNAVAILABLE" });
        return false;
      }
      publishSpaceClip({
        status: "filtering",
        strategy: SPACE_MEMBERSHIP_STRATEGY,
        scannedObjectCount: 0,
        totalObjectCount: 0,
      });
      const classification = await applySpaceMembershipFilter();
      if (!classification) return false;
      publishSpaceClip({
        status: "active",
        strategy: SPACE_MEMBERSHIP_STRATEGY,
        retainedObjectCount: classification.retainedObjectCount,
      });
      return true;
    },
    clearSpaceClip() {
      const cleared = clearActiveSpaceClip();
      viewer.scene.render(true);
      return cleared;
    },
    requestLevelOptions() {
      return publishLevelOptions();
    },
    setLevelClip({ lowerLevelRef, upperLevelRef, lowerOffsetMm, upperOffsetMm } = {}) {
      if (levelOptionsByReference.size === 0) publishLevelOptions();
      const lowerLevel = levelOptionsByReference.get(String(lowerLevelRef || ""));
      const upperLevel = levelOptionsByReference.get(String(upperLevelRef || ""));
      const normalizedLowerOffsetMm = normalizeLevelOffsetMm(lowerOffsetMm);
      const normalizedUpperOffsetMm = normalizeLevelOffsetMm(upperOffsetMm);
      if (!lowerLevel || !upperLevel || normalizedLowerOffsetMm === null || normalizedUpperOffsetMm === null) {
        publishLevelClip({ status: "rejected", reason: "UNKNOWN_LEVEL" });
        return false;
      }
      const lowerElevation = lowerLevel.elevation + normalizedLowerOffsetMm * METRES_PER_MILLIMETRE;
      const upperElevation = upperLevel.elevation + normalizedUpperOffsetMm * METRES_PER_MILLIMETRE;
      if (upperElevation <= lowerElevation) {
        publishLevelClip({ status: "rejected", reason: "INVALID_LEVEL_RANGE" });
        return false;
      }
      clearManualSection();
      clearActiveSpaceClip();
      clearActiveLevelClip();
      try {
        createLevelClipPlanes(lowerElevation, upperElevation);
      } catch {
        clearLevelClipPlanes();
        publishLevelClip({ status: "rejected", reason: "LEVEL_ELEVATION_UNAVAILABLE" });
        return false;
      }
      activeLevelClip = {
        lowerLevel,
        upperLevel,
        lowerOffsetMm: normalizedLowerOffsetMm,
        upperOffsetMm: normalizedUpperOffsetMm,
      };
      viewer.scene.render(true);
      publishLevelClip({
        status: "active",
        lowerLabel: lowerLevel.label,
        upperLabel: upperLevel.label,
        lowerOffsetMm: normalizedLowerOffsetMm,
        upperOffsetMm: normalizedUpperOffsetMm,
      });
      return true;
    },
    clearLevelClip() {
      const cleared = clearActiveLevelClip();
      viewer.scene.render(true);
      return cleared;
    },
    clearSpaceClipForModel(modelId) {
      if (!activeSpaceClip || (activeSpaceClip.modelId && activeSpaceClip.modelId !== modelId)) return false;
      const cleared = clearActiveSpaceClip();
      viewer.scene.render(true);
      return cleared;
    },
    applySpaceClipForModel() {
      return applySpaceMembershipFilter();
    },
    destroy() {
      clearActiveSpaceClip({ publish: false });
      clearActiveLevelClip({ publish: false });
      axisLabels.destroy();
      sectionPlanes.destroy();
    },
  });
}
