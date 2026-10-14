import test from "node:test";
import assert from "node:assert/strict";
import { buildAxisRange, classifyAxisRangeAabb, gridRangeOptions }
  from "../../packages/viewer/src/xeokit/axis-range-geometry.js";
const bounds = { x: [0, 10], y: [0, 10], z: [0, 10] };
const range = () => buildAxisRange({ bounds });
const aabb = (x, y, z) => [x[0], z[0], -y[1], x[1], z[1], -y[0]];

test("all engineering XYZ intervals apply simultaneously, with renderer Y as elevation", () => {
  assert.equal(classifyAxisRangeAabb(aabb([1, 2], [3, 4], [5, 6]), range()), "inside");
  for (const key of ["x", "y", "z"]) {
    const candidate = { x: [1, 2], y: [3, 4], z: [5, 6], [key]: [11, 12] };
    assert.equal(classifyAxisRangeAabb(aabb(candidate.x, candidate.y, candidate.z), range()), "outside", key);
  }
});

test("crossing each boundary is separate from full containment and touching is included", () => {
  for (const key of ["x", "y", "z"]) {
    const candidate = { x: [1, 2], y: [3, 4], z: [5, 6], [key]: [-1, 1] };
    assert.equal(classifyAxisRangeAabb(aabb(candidate.x, candidate.y, candidate.z), range()), "boundary", key);
  }
  assert.equal(classifyAxisRangeAabb(aabb([0, 10], [0, 10], [0, 10]), range()), "inside");
  assert.equal(classifyAxisRangeAabb(aabb([10, 12], [1, 2], [1, 2]), range()), "boundary");
  assert.equal(classifyAxisRangeAabb(aabb([-0.0000001, 1], [1, 2], [1, 2]), range()), "inside");
});

test("negative elevations and translated grid frame are supported", () => {
  const r = buildAxisRange({ bounds: { x: [-10, -1], y: [-20, -2], z: [-10, -1] },
    frame: { origin: [100, 200], x: [1, 0], y: [0, 1] } });
  assert.equal(classifyAxisRangeAabb(aabb([92, 94], [185, 190], [-6, -4]), r), "inside");
});

test("rotated grid uses SAT in both bases, with no corner false intersections", () => {
  const c = Math.SQRT1_2;
  const r = buildAxisRange({ bounds: { x: [-1, 1], y: [-1, 1], z: [0, 2] },
    frame: { origin: [0, 0], x: [c, c], y: [-c, c] }, mode: "intersects" });
  assert.equal(classifyAxisRangeAabb(aabb([-0.2, 0.2], [-0.2, 0.2], [0.2, 1]), r), "inside");
  assert.equal(classifyAxisRangeAabb(aabb([1, 1.2], [-0.2, 0.2], [0.2, 1]), r), "inside");
  assert.equal(classifyAxisRangeAabb(aabb([1, 1.6], [-0.2, 0.2], [0.2, 1]), r), "boundary");
  assert.equal(classifyAxisRangeAabb(aabb([1.5, 2], [-2, 2], [0.2, 1]), r), "outside");
});

test("missing, reversed, nonnumeric and nonfinite boxes are reported, never selected", () => {
  for (const value of [null, [], [0, 0, 0, -1, 1, 1], [0, 0, 0, Infinity, 1, 1],
    [null, 0, 0, 1, 1, 1], ["0", 0, 0, 1, 1, 1]]) {
    assert.equal(classifyAxisRangeAabb(value, range()), "missing");
  }
  assert.equal(classifyAxisRangeAabb(new Float64Array(aabb([1, 2], [1, 2], [1, 2])), range()), "inside");
});

test("invalid bounds, frame, mode or tolerance fail closed", () => {
  for (const value of [undefined, [0, 0], [2, 1], [0, Infinity], [null, 1], ["", 1]]) {
    assert.throws(() => buildAxisRange({ bounds: { ...bounds, z: value } }), { code: "invalid_bounds" });
  }
  assert.throws(() => buildAxisRange({ bounds, mode: "anything" }), { code: "invalid_mode" });
  assert.throws(() => buildAxisRange({ bounds, tolerance: 1 }), { code: "invalid_tolerance" });
  for (const frame of [{}, { origin: [0, 0], x: [2, 0], y: [0, 1] },
    { origin: [0, 0], x: [1, 0], y: [1, 0] }]) {
    assert.throws(() => buildAxisRange({ bounds, frame }), { code: "invalid_frame" });
  }
});

const grid = () => ({
  revision: { id: "r1", content_hash: "hash-r1", status: "active", validation_status: "valid",
    source_version_id: "model-a", project_transform_id: "t1", coordinate_space: "global_shared",
    unit: "m", unit_verified: true },
  project_transform: { id: "t1", status: "active", unit: "m", content_hash: "hash-t1" },
  grid_payload: { coordinate_space: "global_shared", unit: "m", grid_systems: [{ global_id: "grid1", name: "Main",
    u_axes: [{ tag: "A", start: [0, 0, 0], end: [0, 10, 0] }, { tag: "B", start: [10, 10, 0], end: [10, 0, 0] }],
    v_axes: [{ tag: "1", start: [0, 0, 0], end: [10, 0, 0] }, { tag: "2", start: [0, 10, 0], end: [10, 10, 0] }],
    w_axes: [{ tag: "Not elevation", start: [0, 0, 0], end: [0, 0, 10] }],
  }] },
});

test("verified grid produces stable U/V boundary positions, independent of line direction", () => {
  const [system] = gridRangeOptions(grid(), "model-a");
  assert.equal(system.id, "r1:grid1");
  assert.deepEqual(system.xAxes.map(({ value }) => value), [0, 10]);
  assert.deepEqual(system.yAxes.map(({ value }) => value), [0, 10]);
  assert.equal(system.zAxes, undefined, "W never becomes elevation implicitly");
  assert.equal(classifyAxisRangeAabb(aabb([1, 2], [1, 2], [1, 2]), buildAxisRange({ bounds, frame: system.frame })), "inside");
});

test("unverified grid/model/transform binding returns no range options", () => {
  assert.deepEqual(gridRangeOptions(grid(), "other-model"), []);
  for (const [key, value] of [["status", "draft"], ["validation_status", "needs_review"],
    ["unit_verified", false], ["unit", "mm"], ["coordinate_space", "local"],
    ["project_transform_id", "other"], ["content_hash", ""], ["source_version_id", null]]) {
    const g = grid(); g.revision[key] = value;
    assert.deepEqual(gridRangeOptions(g, "model-a"), [], key);
  }
  const g = grid(); g.project_transform.status = "superseded";
  assert.deepEqual(gridRangeOptions(g, "model-a"), []);
});

test("rotated perpendicular grid is supported; skew, varying or sloping axes rejected", () => {
  const g = grid(); const c = Math.SQRT1_2;
  for (const family of ["u_axes", "v_axes"]) for (const axis of g.grid_payload.grid_systems[0][family]) {
    for (const key of ["start", "end"]) {
      const [x, y, z] = axis[key]; axis[key] = [(x - y) * c, (x + y) * c, z];
    }
  }
  assert.equal(gridRangeOptions(g, "model-a").length, 1);
  for (const endpoint of [[2, 10, 0], [0, 10, 1], [0, 0, 0]]) {
    const bad = grid(); bad.grid_payload.grid_systems[0].u_axes[0].end = endpoint;
    assert.deepEqual(gridRangeOptions(bad, "model-a"), []);
  }
});
