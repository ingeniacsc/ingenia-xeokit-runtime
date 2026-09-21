// SPDX-License-Identifier: AGPL-3.0-only

const MIN_TRIANGLE_AREA = 1e-8;
const HORIZONTAL_X = 0;
const VERTICAL_Y = 1;
const HORIZONTAL_Z = 2;
const DEFAULT_BATCH_SIZE = 180;

function finitePoint(positions, index) {
  const offset = index * 3;
  const point = [positions[offset], positions[offset + 1], positions[offset + 2]];
  return point.every(Number.isFinite) ? point : null;
}

function crossProduct(a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
}

function isRenderableAabb(aabb) {
  const values = Array.from(aabb || []);
  return values.length === 6
    && values.every(Number.isFinite)
    && values[3] > values[0]
    && values[4] > values[1]
    && values[5] > values[2];
}

function addGeometryTriangles(geometry, triangles) {
  const positions = geometry?.positions;
  const indices = geometry?.indices;
  if (!positions || positions.length < 9) return false;
  const triangleIndices = indices?.length >= 3
    ? Array.from(indices)
    : Array.from({ length: Math.floor(positions.length / 3) }, (_, index) => index);
  if (triangleIndices.length % 3 !== 0) return false;
  let added = false;
  for (let index = 0; index < triangleIndices.length; index += 3) {
    const a = finitePoint(positions, triangleIndices[index]);
    const b = finitePoint(positions, triangleIndices[index + 1]);
    const c = finitePoint(positions, triangleIndices[index + 2]);
    if (!a || !b || !c) continue;
    triangles.push([a, b, c]);
    added = true;
  }
  return added;
}

function projectedPoint(point) {
  return [point[HORIZONTAL_X], point[HORIZONTAL_Z]];
}

function pointKey([x, z], precision) {
  return `${Math.round(x * precision)}:${Math.round(z * precision)}`;
}

function signedArea(points) {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

function buildFootprintLoops(triangles, precision) {
  const edgeCounts = new Map();
  const addEdge = (a, b) => {
    const aKey = pointKey(a, precision);
    const bKey = pointKey(b, precision);
    if (aKey === bKey) return;
    const key = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
    const entry = edgeCounts.get(key) || { count: 0, aKey, bKey, a, b };
    entry.count += 1;
    edgeCounts.set(key, entry);
  };
  triangles.forEach((triangle) => {
    const points = triangle.map(projectedPoint);
    addEdge(points[0], points[1]);
    addEdge(points[1], points[2]);
    addEdge(points[2], points[0]);
  });
  const edges = Array.from(edgeCounts.values()).filter((entry) => entry.count === 1);
  const byPoint = new Map();
  edges.forEach((edge, index) => {
    [edge.aKey, edge.bKey].forEach((key) => {
      const entries = byPoint.get(key) || [];
      entries.push(index);
      byPoint.set(key, entries);
    });
  });
  if (edges.length < 3 || Array.from(byPoint.values()).some((entries) => entries.length !== 2)) return [];
  const unused = new Set(edges.map((_, index) => index));
  const loops = [];
  while (unused.size > 0) {
    const firstIndex = unused.values().next().value;
    const first = edges[firstIndex];
    const startKey = first.aKey;
    const loop = [first.a];
    let currentKey = first.bKey;
    unused.delete(firstIndex);
    let guard = edges.length + 1;
    while (currentKey !== startKey && guard > 0) {
      guard -= 1;
      const candidates = (byPoint.get(currentKey) || []).filter((index) => unused.has(index));
      if (candidates.length !== 1) return [];
      const edge = edges[candidates[0]];
      unused.delete(candidates[0]);
      loop.push(edge.aKey === currentKey ? edge.a : edge.b);
      currentKey = edge.aKey === currentKey ? edge.bKey : edge.aKey;
    }
    if (currentKey !== startKey || loop.length < 3 || Math.abs(signedArea(loop)) <= MIN_TRIANGLE_AREA) return [];
    loops.push(Object.freeze(loop.map((point) => Object.freeze(point.slice()))));
  }
  return loops;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [xi, zi] = polygon[index];
    const [xj, zj] = polygon[previous];
    if ((zi > point[1]) !== (zj > point[1])
        && point[0] < ((xj - xi) * (point[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function pointInFootprint(point, polygons) {
  return polygons.reduce((inside, polygon) => (pointInPolygon(point, polygon) ? !inside : inside), false);
}

function orientation(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsIntersect(a, b, c, d) {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return (abC === 0 || abD === 0 || cdA === 0 || cdB === 0)
    || ((abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0));
}

function footprintIntersectsAabb(polygons, aabb) {
  const corners = [[aabb[0], aabb[2]], [aabb[3], aabb[2]], [aabb[3], aabb[5]], [aabb[0], aabb[5]]];
  if (corners.some((point) => pointInFootprint(point, polygons))) return true;
  const rectangleEdges = corners.map((point, index) => [point, corners[(index + 1) % corners.length]]);
  return polygons.some((polygon) => polygon.some((point, index) => {
    if (point[0] >= aabb[0] && point[0] <= aabb[3] && point[1] >= aabb[2] && point[1] <= aabb[5]) return true;
    return rectangleEdges.some(([start, end]) => segmentsIntersect(start, end, point, polygon[(index + 1) % polygon.length]));
  }));
}

function nextBrowserTurn() {
  return new Promise((resolve) => {
    if (typeof globalThis.requestAnimationFrame === "function") globalThis.requestAnimationFrame(resolve);
    else globalThis.setTimeout(resolve, 0);
  });
}

function capElevation(triangles) {
  const elevations = triangles.flatMap((triangle) => triangle.map((point) => point[VERTICAL_Y]));
  if (elevations.length === 0 || elevations.some((value) => !Number.isFinite(value))) return null;
  return elevations.reduce((sum, value) => sum + value, 0) / elevations.length;
}

export function buildIfcSpaceMembershipVolume(entity) {
  const aabb = Array.from(entity?.aabb || []);
  if (!isRenderableAabb(aabb)) return Object.freeze({ ok: false, reason: "INVALID_AABB" });
  const triangles = [];
  try {
    addGeometryTriangles(entity?.getGeometryData?.(), triangles);
    if (triangles.length === 0) {
      Array.from(entity?.meshes || []).forEach((mesh) => {
        addGeometryTriangles(mesh?.layer?.readGeometryData?.(mesh.portionId), triangles);
      });
    }
  } catch {
    return Object.freeze({ ok: false, reason: "SPACE_GEOMETRY_UNAVAILABLE" });
  }
  if (triangles.length === 0) return Object.freeze({ ok: false, reason: "SPACE_GEOMETRY_UNAVAILABLE" });
  const diagonal = Math.hypot(aabb[3] - aabb[0], aabb[4] - aabb[1], aabb[5] - aabb[2]);
  const tolerance = Math.max(0.001, diagonal * 1e-5);
  const horizontalCaps = triangles.filter((triangle) => {
    const elevations = triangle.map((point) => point[VERTICAL_Y]);
    const horizontal = Math.abs(crossProduct(...triangle)[VERTICAL_Y]) > MIN_TRIANGLE_AREA;
    return horizontal && (elevations.every((value) => Math.abs(value - aabb[1]) <= tolerance)
      || elevations.every((value) => Math.abs(value - aabb[4]) <= tolerance));
  });
  const floorCaps = horizontalCaps.filter((triangle) => triangle.every((point) => Math.abs(point[VERTICAL_Y] - aabb[1]) <= tolerance));
  const ceilingCaps = horizontalCaps.filter((triangle) => triangle.every((point) => Math.abs(point[VERTICAL_Y] - aabb[4]) <= tolerance));
  const floorElevation = capElevation(floorCaps);
  const ceilingElevation = capElevation(ceilingCaps);
  if (!Number.isFinite(floorElevation) || !Number.isFinite(ceilingElevation) || ceilingElevation <= floorElevation + tolerance) {
    return Object.freeze({ ok: false, reason: "SPACE_GEOMETRY_UNAVAILABLE" });
  }
  const polygons = buildFootprintLoops(floorCaps, Math.max(1, Math.min(1e6, 1 / tolerance)));
  if (polygons.length === 0) return Object.freeze({ ok: false, reason: "SPACE_FOOTPRINT_INVALID" });
  return Object.freeze({
    ok: true,
    aabb: Object.freeze(aabb),
    floorElevation,
    ceilingElevation,
    polygons: Object.freeze(polygons),
  });
}

export async function classifyVisibleObjectsBySpaceMembership(scene, volume, {
  excludeObjectId,
  batchSize = DEFAULT_BATCH_SIZE,
  onProgress,
  shouldContinue = () => true,
  yieldToBrowser = nextBrowserTurn,
} = {}) {
  const candidates = Object.values(scene?.objects || {}).filter((entity) => (
    entity?.id && entity.id !== excludeObjectId && entity.visible !== false
  ));
  const hiddenObjectIds = [];
  let retainedObjectCount = 0;
  const normalizedBatchSize = Math.max(1, Math.min(1000, Number(batchSize) || DEFAULT_BATCH_SIZE));
  for (let index = 0; index < candidates.length; index += 1) {
    if (!shouldContinue()) {
      return Object.freeze({
        cancelled: true,
        hiddenObjectIds: Object.freeze([]),
        retainedObjectCount: 0,
        scannedObjectCount: index,
        totalObjectCount: candidates.length,
      });
    }
    const entity = candidates[index];
    const aabb = entity.aabb;
    if (isRenderableAabb(aabb) && footprintIntersectsAabb(volume.polygons, aabb)) retainedObjectCount += 1;
    else hiddenObjectIds.push(entity.id);
    const scannedObjectCount = index + 1;
    if (scannedObjectCount % normalizedBatchSize === 0 && scannedObjectCount < candidates.length) {
      onProgress?.({ scannedObjectCount, totalObjectCount: candidates.length });
      await yieldToBrowser();
    }
  }
  onProgress?.({ scannedObjectCount: candidates.length, totalObjectCount: candidates.length });
  return Object.freeze({
    cancelled: false,
    hiddenObjectIds: Object.freeze(hiddenObjectIds),
    retainedObjectCount,
    scannedObjectCount: candidates.length,
    totalObjectCount: candidates.length,
  });
}
