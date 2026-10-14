// SPDX-License-Identifier: AGPL-3.0-only
import { buildAxisRange } from "./axis-range-geometry.js";

const AXES = ["x", "y", "z"];
export const AXIS_PREVIEW_COLORS = Object.freeze({
  x: [0.82, 0.16, 0.13], y: [0.08, 0.55, 0.31], z: [0.12, 0.36, 0.88],
});

// Engineering [east, north, elevation] -> xeokit [east, elevation, -north].
export function axisRangeScenePoint(point, frame) {
  return [frame.origin[0] + frame.x[0] * point[0] + frame.y[0] * point[1], point[2],
    -(frame.origin[1] + frame.x[1] * point[0] + frame.y[1] * point[1])];
}

export function buildAxisRangePreview(spec) {
  const range = buildAxisRange(spec);
  const intervals = AXES.map((axis) => range.bounds[axis]);
  const center = intervals.map(([min, max]) => (min + max) / 2);
  const vectors = [[range.frame.x[0], 0, -range.frame.x[1]],
    [range.frame.y[0], 0, -range.frame.y[1]], [0, 1, 0]];
  const corners = Array.from({ length: 8 }, (_, mask) => axisRangeScenePoint(
    intervals.map((values, axis) => values[(mask >> axis) & 1]), range.frame));
  const planes = AXES.flatMap((axis, index) => [0, 1].map((side) => {
    const local = [...center]; local[index] = intervals[index][side];
    return { axis, side, value: local[index], pos: axisRangeScenePoint(local, range.frame),
      // Xeokit discards positive dot(-dir, point-pos), hence inward normals.
      dir: vectors[index].map((value) => (side ? -value : value) || 0) };
  }));
  const wires = AXES.map((axis, index) => ({ axis,
    positions: corners.flatMap((corner, mask) => (mask & (1 << index)) ? []
      : [...corner, ...corners[mask | (1 << index)]]),
    indices: [0, 1, 2, 3, 4, 5, 6, 7],
  }));
  return { range, corners, planes, wires };
}
