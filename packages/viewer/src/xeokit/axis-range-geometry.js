// SPDX-License-Identifier: AGPL-3.0-only
const EPSILON = 1e-6; // Metres, including comparisons at an exact boundary.
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const vector = (value, size) => Array.isArray(value) && value.length === size && value.every(finite);
function invalid(code) { throw Object.assign(new Error(code), { code }); }

export function buildAxisRange({ bounds, mode = "contained", frame, tolerance = EPSILON } = {}) {
  if (!["contained", "intersects"].includes(mode)) invalid("invalid_mode");
  if (!finite(tolerance) || tolerance < 0 || tolerance > 0.001) invalid("invalid_tolerance");
  for (const key of ["x", "y", "z"]) {
    if (!vector(bounds?.[key], 2) || bounds[key][1] <= bounds[key][0]) invalid("invalid_bounds");
  }
  const basis = frame ?? { origin: [0, 0], x: [1, 0], y: [0, 1] };
  if (!vector(basis.origin, 2) || !vector(basis.x, 2) || !vector(basis.y, 2)
    || Math.abs(dot(basis.x, basis.x) - 1) > 1e-8
    || Math.abs(dot(basis.y, basis.y) - 1) > 1e-8
    || Math.abs(dot(basis.x, basis.y)) > 1e-8) invalid("invalid_frame");
  return {
    bounds: Object.fromEntries(["x", "y", "z"].map((key) => [key, [...bounds[key]]])),
    frame: { origin: [...basis.origin], x: [...basis.x], y: [...basis.y] }, mode, tolerance,
  };
}

// Scene AABBs are [east, elevation, -north]. Never interpret renderer Y as BIM Y.
// SAT uses both rectangle bases, avoiding projected-box false intersections at corners.
export function classifyAxisRangeAabb(aabb, range) {
  if ((!Array.isArray(aabb) && !ArrayBuffer.isView(aabb)) || aabb.length !== 6
    || !Array.from(aabb).every(finite) || [0, 1, 2].some((i) => aabb[i] > aabb[i + 3])) return "missing";
  const { bounds, frame, tolerance: epsilon } = range;
  if (aabb[4] < bounds.z[0] - epsilon || aabb[1] > bounds.z[1] + epsilon) return "outside";
  const center = [(aabb[0] + aabb[3]) / 2, -(aabb[2] + aabb[5]) / 2];
  const half = [(aabb[3] - aabb[0]) / 2, (aabb[5] - aabb[2]) / 2];
  const local = [dot(center.map((v, i) => v - frame.origin[i]), frame.x),
    dot(center.map((v, i) => v - frame.origin[i]), frame.y)];
  const radii = [frame.x, frame.y].map((axis) => Math.abs(axis[0]) * half[0] + Math.abs(axis[1]) * half[1]);
  const boxHalf = [(bounds.x[1] - bounds.x[0]) / 2, (bounds.y[1] - bounds.y[0]) / 2];
  const boxLocal = [(bounds.x[1] + bounds.x[0]) / 2, (bounds.y[1] + bounds.y[0]) / 2];
  const boxCenter = frame.origin.map((v, i) => v + frame.x[i] * boxLocal[0] + frame.y[i] * boxLocal[1]);
  const delta = center.map((v, i) => v - boxCenter[i]);
  for (const axis of [[1, 0], [0, 1], frame.x, frame.y]) {
    const radiusA = Math.abs(axis[0]) * half[0] + Math.abs(axis[1]) * half[1];
    const radiusB = Math.abs(dot(axis, frame.x)) * boxHalf[0] + Math.abs(dot(axis, frame.y)) * boxHalf[1];
    if (Math.abs(dot(delta, axis)) > radiusA + radiusB + epsilon) return "outside";
  }
  const horizontalInside = [bounds.x, bounds.y].every((interval, i) =>
    local[i] - radii[i] >= interval[0] - epsilon && local[i] + radii[i] <= interval[1] + epsilon);
  return horizontalInside && aabb[1] >= bounds.z[0] - epsilon && aabb[4] <= bounds.z[1] + epsilon
    ? "inside" : "boundary";
}

function axisNormal(axis) {
  if (!vector(axis?.start, 3) || !vector(axis?.end, 3)
    || Math.abs(axis.start[2] - axis.end[2]) > EPSILON) return null;
  const dx = axis.end[0] - axis.start[0];
  const dy = axis.end[1] - axis.start[1];
  const length = Math.hypot(dx, dy);
  if (length <= EPSILON) return null;
  let normal = [-dy / length, dx / length];
  const dominant = Math.abs(normal[0]) >= Math.abs(normal[1]) ? 0 : 1;
  if (normal[dominant] < 0) normal = normal.map((v) => -v);
  return normal;
}

// Eligibility is deliberately scoped to the model from which the active grid was extracted.
// Other models need their own verified registration, not mere overlapping AABBs.
export function gridRangeOptions(grid, modelId) {
  const revision = grid?.revision;
  const transform = grid?.project_transform;
  const payload = grid?.grid_payload;
  if (!modelId || !revision?.id || !revision.content_hash || revision.status !== "active"
    || revision.validation_status !== "valid" || String(revision.source_version_id) !== String(modelId)
    || revision.coordinate_space !== "global_shared" || revision.unit !== "m" || revision.unit_verified !== true
    || !transform?.id || !transform.content_hash || transform.status !== "active" || transform.unit !== "m"
    || revision.project_transform_id !== transform.id
    || payload?.coordinate_space !== "global_shared" || payload.unit !== "m"
    || !Array.isArray(payload.grid_systems)) return [];
  return payload.grid_systems.flatMap((system, index) => {
    const u = system?.u_axes; const v = system?.v_axes;
    if (!Array.isArray(u) || !Array.isArray(v) || u.length < 2 || v.length < 2) return [];
    const x = axisNormal(u[0]); const y = axisNormal(v[0]);
    if (!x || !y || Math.abs(dot(x, y)) > 1e-8) return [];
    const options = (axes, normal, family) => {
      if (axes.some((axis) => {
        const candidate = axisNormal(axis);
        return !candidate || Math.abs(Math.abs(dot(candidate, normal)) - 1) > 1e-8;
      })) return null;
      return axes.map((axis, axisIndex) => ({ id: `${family}:${axisIndex}`,
        label: String(axis.tag || `${family}${axisIndex + 1}`), value: dot(axis.start, normal) }))
        .sort((a, b) => a.value - b.value);
    };
    const xAxes = options(u, x, "U"); const yAxes = options(v, y, "V");
    if (!xAxes || !yAxes || xAxes.at(-1).value - xAxes[0].value <= EPSILON
      || yAxes.at(-1).value - yAxes[0].value <= EPSILON) return [];
    return [{ id: `${revision.id}:${system.global_id || index}`, label: String(system.name || `Grid ${index + 1}`),
      frame: { origin: [0, 0], x, y }, xAxes, yAxes }];
  });
}
