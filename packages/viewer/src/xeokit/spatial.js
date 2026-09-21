// SPDX-License-Identifier: AGPL-3.0-only
import { Mesh, PhongMaterial, ReadableGeometry, SectionPlanesPlugin } from "@xeokit/xeokit-sdk";
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
const PROJECT_GRID_PREFIX = "project-grid:";
const MAX_PROJECT_GRID_LABELS = 96;
const SITE_CONTEXT_PREFIX = "site-context:";

function finiteAabb(aabb) {
  const values = Array.from(aabb || []).map(Number);
  return values.length === 6 && values.every(Number.isFinite) ? values : null;
}

function aabbFromPositions(positions) {
  if (!positions.length) return null;
  const aabb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    aabb[0] = Math.min(aabb[0], positions[index]);
    aabb[1] = Math.min(aabb[1], positions[index + 1]);
    aabb[2] = Math.min(aabb[2], positions[index + 2]);
    aabb[3] = Math.max(aabb[3], positions[index]);
    aabb[4] = Math.max(aabb[4], positions[index + 1]);
    aabb[5] = Math.max(aabb[5], positions[index + 2]);
  }
  return aabb.every(Number.isFinite) ? aabb : null;
}

function mergeAabb(target, source) {
  if (!source) return target;
  if (!target) return [...source];
  for (let index = 0; index < 3; index += 1) {
    target[index] = Math.min(target[index], source[index]);
    target[index + 3] = Math.max(target[index + 3], source[index + 3]);
  }
  return target;
}

function aabbIntersects(left, right) {
  if (!left || !right) return true;
  return [0, 1, 2].every((axis) => left[axis] <= right[axis + 3] && left[axis + 3] >= right[axis]);
}

function appendGridRibbon(positions, indices, start, end, width) {
  const dx = end[0] - start[0];
  const dz = end[2] - start[2];
  const length = Math.hypot(dx, dz);
  if (!Number.isFinite(length) || length <= 0) return false;
  const halfWidth = width / 2;
  const offsetX = (-dz / length) * halfWidth;
  const offsetZ = (dx / length) * halfWidth;
  const vertex = positions.length / 3;
  positions.push(
    start[0] + offsetX, start[1], start[2] + offsetZ,
    start[0] - offsetX, start[1], start[2] - offsetZ,
    end[0] - offsetX, end[1], end[2] - offsetZ,
    end[0] + offsetX, end[1], end[2] + offsetZ,
  );
  indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3);
  return true;
}

function projectGridPoint(point) {
  if (!Array.isArray(point) || point.length < 3) return null;
  const [east, north, elevation] = point.map(Number);
  if (![east, north, elevation].every(Number.isFinite)) return null;
  // The XKT artifact is converted from this IFC without a model origin or
  // transform. Keep the extracted shared coordinates unchanged and only map
  // IFC Z-up coordinates to xeokit's Y-up world axes.
  return [east, elevation, -north];
}

function resolveGridAxisSection(gridAxis) {
  const start = projectGridPoint(gridAxis?.start);
  const end = projectGridPoint(gridAxis?.end);
  if (!start || !end) return null;
  const dx = end[0] - start[0];
  const dz = end[2] - start[2];
  const length = Math.hypot(dx, dz);
  if (!Number.isFinite(length) || length <= 1e-6) return null;
  return {
    pos: start.map((value, index) => (value + end[index]) / 2),
    // A project-grid section is vertical: its normal lies in xeokit's XZ plane
    // and is perpendicular to the IFC grid line after the Z-up to Y-up mapping.
    dir: [-dz / length, 0, dx / length],
  };
}

function createProjectGridLabels(viewer) {
  const host = document.querySelector("#viewport-shell") || document.body;
  const overlay = document.createElement("div");
  overlay.className = "ingenia-project-grid-labels";
  overlay.setAttribute("aria-hidden", "true");
  host.appendChild(overlay);
  let rows = [];
  let frameId = 0;
  let destroyed = false;

  function render() {
    frameId = 0;
    if (destroyed) return;
    overlay.replaceChildren();
    const canvas = viewer?.scene?.canvas?.canvas;
    const width = canvas?.clientWidth || canvas?.width || 0;
    const height = canvas?.clientHeight || canvas?.height || 0;
    rows.slice(0, MAX_PROJECT_GRID_LABELS).forEach((row) => {
      let point = viewer?.camera?.projectWorldPos?.(row.worldPos);
      if (row.sticky && Array.isArray(row.worldEnd)) {
        const endPoint = viewer?.camera?.projectWorldPos?.(row.worldEnd);
        const candidates = [point, endPoint].filter(
          (candidate) => candidate && Number.isFinite(candidate[0]) && Number.isFinite(candidate[1]),
        );
        point = candidates.sort((left, right) => (
          Math.hypot(left[0] - width / 2, left[1] - height / 2)
          - Math.hypot(right[0] - width / 2, right[1] - height / 2)
        ))[0];
        if (point) {
          point = [
            Math.min(width - 18, Math.max(18, point[0])),
            Math.min(height - 18, Math.max(18, point[1])),
          ];
        }
      }
      if (point && row.screenSide === "left") {
        point = [12, Math.min(height - 18, Math.max(18, point[1]))];
      } else if (point && row.screenSide === "right") {
        point = [width - 12, Math.min(height - 18, Math.max(18, point[1]))];
      }
      if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return;
      if (point[0] < -80 || point[0] > width + 80 || point[1] < -40 || point[1] > height + 40) return;
      const label = document.createElement("span");
      label.className = `ingenia-project-grid-label ingenia-project-grid-${row.kind}-label`;
      label.textContent = row.label;
      label.style.left = `${Number(point[0])}px`;
      label.style.top = `${Number(point[1])}px`;
      overlay.appendChild(label);
    });
  }

  function scheduleRender() {
    if (frameId || destroyed) return;
    frameId = window.requestAnimationFrame(render);
  }

  const viewHandle = viewer?.camera?.on?.("viewMatrix", scheduleRender);
  const projectionHandle = viewer?.camera?.on?.("projMatrix", scheduleRender);
  return Object.freeze({
    set(nextRows) {
      rows = Array.isArray(nextRows) ? nextRows : [];
      scheduleRender();
    },
    clear() {
      rows = [];
      overlay.replaceChildren();
    },
    destroy() {
      destroyed = true;
      if (frameId) window.cancelAnimationFrame(frameId);
      if (viewHandle !== undefined) viewer?.camera?.off?.(viewHandle);
      if (projectionHandle !== undefined) viewer?.camera?.off?.(projectionHandle);
      overlay.remove();
    },
  });
}

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
  const projectGridLabels = createProjectGridLabels(viewer);
  let activeSpaceClip = null;
  let activeLevelClip = null;
  let projectGridMeshes = [];
  let siteContextMeshes = [];
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

  function clearProjectGrid() {
    projectGridMeshes.forEach(({ mesh, geometry, material }) => {
      mesh?.destroy?.();
      geometry?.destroy?.();
      material?.destroy?.();
    });
    projectGridMeshes = [];
    projectGridLabels.clear();
  }

  function normalizeProjectLevels(levels) {
    return (Array.isArray(levels) ? levels : []).reduce((result, level) => {
      const elevation = Number(level?.elevation);
      const code = String(level?.code || "").trim();
      const name = String(level?.name || "").trim();
      if (!Number.isFinite(elevation) || (!code && !name)) return result;
      const label = code && name && code !== name ? `${code} · ${name}` : (name || code);
      result.push({ elevation, label });
      return result;
    }, []);
  }

  function matchingProjectLevelLabel(levels, elevation) {
    if (!Number.isFinite(elevation) || !levels.length) return "";
    const nearestDifference = Math.min(...levels.map((level) => Math.abs(level.elevation - elevation)));
    if (nearestDifference > 0.5) return "";
    return Array.from(new Set(levels
      .filter((level) => Math.abs(Math.abs(level.elevation - elevation) - nearestDifference) <= 0.001)
      .map((level) => level.label)))
      .join(" / ")
      .slice(0, 320);
  }

  function setProjectGrid({ grid, levels = [], visibleElevations = [], stickyLabels = true } = {}) {
    clearProjectGrid();
    const modelAabb = finiteAabb(viewer.scene.getAABB());
    const systems = grid?.grid_payload?.grid_systems || [];
    let axisCount = 0;
    let gridAabb = null;
    const labelCandidates = [];
    const registryLevels = normalizeProjectLevels(levels);
    const knownLevels = registryLevels.length ? registryLevels : resolveStoreyLevels(viewer);
    const selectedElevations = Array.isArray(visibleElevations)
      ? visibleElevations.map(Number).filter(Number.isFinite).slice(0, MAX_LEVEL_OPTIONS)
      : [];
    systems.forEach((system, systemIndex) => {
      const declaredElevations = Array.isArray(system?.elevations)
        ? system.elevations.map(Number).filter(Number.isFinite)
        : [];
      const elevations = declaredElevations.length ? declaredElevations : [null];
      elevations.forEach((elevation, elevationIndex) => {
        if (selectedElevations.length && (!Number.isFinite(elevation)
          || !selectedElevations.some((selected) => Math.abs(selected - elevation) <= 0.001))) return;
        const positions = [];
        const indices = [];
        const transformedAxes = [];
        ["u_axes", "v_axes", "w_axes"].forEach((axisGroup) => {
          (system?.[axisGroup] || []).forEach((axis) => {
            const atElevation = (point) => (
              Number.isFinite(elevation) && Array.isArray(point)
                ? [point[0], point[1], elevation]
                : point
            );
            const start = projectGridPoint(atElevation(axis?.start));
            const end = projectGridPoint(atElevation(axis?.end));
            if (!start || !end) return;
            transformedAxes.push({ start, end, tag: String(axis?.tag || "").trim() });
          });
        });
        if (!transformedAxes.length) return;
        const linePositions = transformedAxes.flatMap(({ start, end }) => [...start, ...end]);
        const systemAabb = aabbFromPositions(linePositions);
        const diagonal = systemAabb
          ? Math.hypot(systemAabb[3] - systemAabb[0], systemAabb[5] - systemAabb[2])
          : 0;
        const ribbonWidth = Math.min(0.12, Math.max(0.025, diagonal * 0.00045));
        transformedAxes.forEach(({ start, end }) => {
          if (appendGridRibbon(positions, indices, start, end, ribbonWidth)) axisCount += 1;
        });
        if (!indices.length) return;
        gridAabb = mergeAabb(gridAabb, aabbFromPositions(positions));
        const id = `${PROJECT_GRID_PREFIX}${grid?.revision?.id || "active"}:${systemIndex}:${elevationIndex}`;
        const geometry = new ReadableGeometry(viewer.scene, {
          id: `${id}:geometry`,
          primitive: "triangles",
          positions,
          indices,
        });
        const material = new PhongMaterial(viewer.scene, {
          id: `${id}:material`,
          diffuse: [0.0, 0.78, 0.86],
          emissive: [0.0, 0.68, 0.74],
          backfaces: true,
        });
        const mesh = new Mesh(viewer.scene, {
          id,
          geometry,
          material,
          pickable: false,
          collidable: false,
          clippable: false,
        });
        projectGridMeshes.push({ mesh, geometry, material });

        const matchedLevelLabel = matchingProjectLevelLabel(knownLevels, elevation);
        if (systemAabb && Number.isFinite(elevation)) {
          labelCandidates.push({
            kind: "elevation",
            label: `Cao độ ${elevation.toFixed(3)} m`,
            elevation: systemAabb[1],
            worldPos: [systemAabb[0], systemAabb[1], systemAabb[5]],
            screenSide: "left",
          });
        }
        if (systemAabb && matchedLevelLabel) {
          labelCandidates.push({
            kind: "level",
            label: matchedLevelLabel,
            elevation: systemAabb[1],
            worldPos: [systemAabb[3], systemAabb[1], systemAabb[2]],
            screenSide: "right",
          });
        }
        transformedAxes.forEach(({ start, end, tag }) => {
          if (!tag) return;
          labelCandidates.push({
            kind: "axis",
            label: tag,
            elevation: start[1],
            worldPos: start,
            worldEnd: end,
            sticky: stickyLabels === true,
          });
        });
      });
    });
    const highestElevation = labelCandidates.reduce(
      (highest, row) => row.kind === "axis" ? Math.max(highest, row.elevation) : highest,
      -Infinity,
    );
    const seenLabels = new Set();
    projectGridLabels.set(labelCandidates.filter((row) => {
      if (row.kind === "axis" && Math.abs(row.elevation - highestElevation) > 0.001) return false;
      const key = `${row.kind}:${row.label}:${row.worldPos.map((value) => Number(value).toFixed(3)).join(":")}`;
      if (seenLabels.has(key)) return false;
      seenLabels.add(key);
      return true;
    }));
    viewer.scene.render(true);
    return {
      status: axisCount > 0 ? (aabbIntersects(gridAabb, modelAabb) ? "visible" : "outside-model") : "empty",
      gridCount: projectGridMeshes.length,
      axisCount,
      gridAabb,
      modelAabb,
    };
  }

  function clearSiteContext() {
    siteContextMeshes.forEach(({ mesh, geometry, material }) => {
      mesh?.destroy?.();
      geometry?.destroy?.();
      material?.destroy?.();
    });
    siteContextMeshes = [];
  }

  function setSiteContext({ site } = {}) {
    clearSiteContext();
    const parcel = Array.isArray(site?.parcel) ? site.parcel.slice(0, 1000) : [];
    const rawElevation = site?.elevation;
    const elevation = rawElevation === null || rawElevation === undefined || rawElevation === ''
      || typeof rawElevation === 'boolean' ? Number.NaN : Number(rawElevation);
    const points = parcel
      .map((point) => projectGridPoint([point?.[0], point?.[1], elevation]))
      .filter(Boolean);
    const modelAabb = finiteAabb(viewer.scene.getAABB());
    if (points.length < 3 || !Number.isFinite(elevation)) {
      viewer.scene.render(true);
      return { status: "empty", vertexCount: 0, siteAabb: null, modelAabb };
    }
    const first = points[0];
    const last = points[points.length - 1];
    if (first.some((value, index) => Math.abs(value - last[index]) > 1e-6)) points.push([...first]);
    const pointAabb = aabbFromPositions(points.flat());
    const diagonal = pointAabb
      ? Math.hypot(pointAabb[3] - pointAabb[0], pointAabb[5] - pointAabb[2])
      : 0;
    const ribbonWidth = Math.min(0.35, Math.max(0.06, diagonal * 0.0012));
    const positions = [];
    const indices = [];
    for (let index = 1; index < points.length; index += 1) {
      appendGridRibbon(positions, indices, points[index - 1], points[index], ribbonWidth);
    }
    if (!indices.length) return { status: "empty", vertexCount: 0, siteAabb: null, modelAabb };
    const id = `${SITE_CONTEXT_PREFIX}${site?.revisionId || "active"}`;
    const geometry = new ReadableGeometry(viewer.scene, {
      id: `${id}:geometry`, primitive: "triangles", positions, indices,
    });
    const material = new PhongMaterial(viewer.scene, {
      id: `${id}:material`,
      diffuse: [190 / 255, 151 / 255, 71 / 255],
      emissive: [0.18, 0.14, 0.06],
      alpha: 0.65,
      alphaMode: "blend",
      backfaces: true,
    });
    const mesh = new Mesh(viewer.scene, {
      id, geometry, material, pickable: false, collidable: false, clippable: false,
    });
    siteContextMeshes.push({ mesh, geometry, material });
    const siteAabb = aabbFromPositions(positions);
    viewer.scene.render(true);
    return {
      status: aabbIntersects(siteAabb, modelAabb) ? "visible" : "outside-model",
      vertexCount: positions.length / 3,
      elevation,
      siteAabb,
      modelAabb,
    };
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
    setProjectGrid,
    setSiteContext,
    setSection({ id = "primary-section", pos, dir = [0, -1, 0], gridAxis } = {}) {
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
      const gridAxisSection = gridAxis ? resolveGridAxisSection(gridAxis) : null;
      if (gridAxis && !gridAxisSection) throw new Error("Invalid project grid axis section.");
      const plane = sectionPlanes.createSectionPlane({
        id,
        pos: gridAxisSection?.pos || pos || center,
        dir: gridAxisSection?.dir || dir,
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
      clearProjectGrid();
      clearSiteContext();
      clearActiveSpaceClip({ publish: false });
      clearActiveLevelClip({ publish: false });
      axisLabels.destroy();
      projectGridLabels.destroy();
      sectionPlanes.destroy();
    },
  });
}
