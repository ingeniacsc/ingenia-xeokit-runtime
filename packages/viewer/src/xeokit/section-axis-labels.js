// SPDX-License-Identifier: AGPL-3.0-only

// IFC uses X = east-west, Y = north-south, and Z = elevation. Xeokit renders
// the same coordinates Y-up, so IFC Y and Z map to Xeokit Z and Y respectively.
const IFC_AXIS_TO_XEOKIT_VECTOR = Object.freeze({
  x: [1, 0, 0],
  y: [0, 0, 1],
  z: [0, 1, 0],
});

function getAxisOffset(aabb) {
  const diagonal = Math.hypot(aabb[3] - aabb[0], aabb[4] - aabb[1], aabb[5] - aabb[2]);
  return Math.min(Math.max(diagonal * 0.04, 1), 8);
}

function isUsablePoint(point) {
  return (
    (Array.isArray(point) || ArrayBuffer.isView(point))
    && point.length >= 2
    && Number.isFinite(point[0])
    && Number.isFinite(point[1])
  );
}

export function createSectionAxisLabels({ viewer, container }) {
  const labels = Object.fromEntries(
    Object.keys(IFC_AXIS_TO_XEOKIT_VECTOR).map((axis) => [axis, container?.querySelector(`[data-axis-label="${axis}"]`)]),
  );
  let plane = null;
  let frameId = 0;
  let destroyed = false;

  function hide(axis) {
    if (labels[axis]) labels[axis].hidden = true;
  }

  function render() {
    if (destroyed || !plane) return;
    const offset = getAxisOffset(viewer.scene.getAABB());
    Object.entries(IFC_AXIS_TO_XEOKIT_VECTOR).forEach(([axis, vector]) => {
      const point = viewer.camera.projectWorldPos([
        plane.pos[0] + vector[0] * offset,
        plane.pos[1] + vector[1] * offset,
        plane.pos[2] + vector[2] * offset,
      ]);
      const label = labels[axis];
      if (!label || !isUsablePoint(point)) {
        hide(axis);
        return;
      }
      label.hidden = false;
      label.style.left = `${point[0]}px`;
      label.style.top = `${point[1]}px`;
    });
    frameId = window.requestAnimationFrame(render);
  }

  function stop() {
    if (frameId) window.cancelAnimationFrame(frameId);
    frameId = 0;
  }

  return Object.freeze({
    setSectionPlane(nextPlane) {
      plane = nextPlane;
      destroyed = false;
      if (container) container.hidden = false;
      stop();
      render();
    },
    clear() {
      plane = null;
      stop();
      if (container) container.hidden = true;
      Object.keys(labels).forEach(hide);
    },
    destroy() {
      destroyed = true;
      plane = null;
      stop();
      if (container) container.hidden = true;
      Object.keys(labels).forEach(hide);
    },
  });
}
