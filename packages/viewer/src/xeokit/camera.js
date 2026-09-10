// SPDX-License-Identifier: AGPL-3.0-only

const VIEW_PRESETS = Object.freeze({
  iso: { direction: [1, 0.4, 1], projection: "perspective", up: [0, 1, 0] },
  front: { direction: [0, 0, 1], projection: "ortho", up: [0, 1, 0] },
  back: { direction: [0, 0, -1], projection: "ortho", up: [0, 1, 0] },
  left: { direction: [-1, 0, 0], projection: "ortho", up: [0, 1, 0] },
  right: { direction: [1, 0, 0], projection: "ortho", up: [0, 1, 0] },
  top: { direction: [0, 1, 0], projection: "ortho", up: [0, 0, -1] },
  bottom: { direction: [0, -1, 0], projection: "ortho", up: [0, 0, 1] },
});

function isRenderableAabb(aabb) {
  const values = Array.from(aabb || []);
  return values.length === 6 && values.every((value) => Number.isFinite(value));
}

function getAabb(viewer, identifiers = []) {
  const aabb = identifiers.length
    ? viewer.scene.getAABB(identifiers)
    : viewer.scene.getAABB();
  return isRenderableAabb(aabb) ? Array.from(aabb) : null;
}

function getAabbCenter(aabb) {
  return [
    (aabb[0] + aabb[3]) / 2,
    (aabb[1] + aabb[4]) / 2,
    (aabb[2] + aabb[5]) / 2,
  ];
}

function getCameraDistance(aabb) {
  const spanX = Math.abs(aabb[3] - aabb[0]);
  const spanY = Math.abs(aabb[4] - aabb[1]);
  const spanZ = Math.abs(aabb[5] - aabb[2]);
  return Math.max(Math.hypot(spanX, spanY, spanZ) * 1.35, 12);
}

function normalizeDirection(direction) {
  const vector = Array.from(direction || []);
  const length = Math.hypot(...vector);
  return vector.length === 3 && length > 0
    ? vector.map((value) => value / length)
    : [0, 0, 1];
}

function fitAabb(viewer, aabb) {
  viewer.cameraFlight.flyTo({ aabb, duration: 0.6 });
}

function getPresetOrthoScale(viewer, aabb, direction, up) {
  const right = [
    direction[1] * up[2] - direction[2] * up[1],
    direction[2] * up[0] - direction[0] * up[2],
    direction[0] * up[1] - direction[1] * up[0],
  ];
  const spans = aabb.slice(3).map((value, index) => Math.abs(value - aabb[index]));
  const projectedSpan = (axis) => spans.reduce((sum, span, index) => sum + span * Math.abs(axis[index]), 0);
  const boundary = viewer.scene.canvas?.boundary;
  const ratio = boundary?.[2] / boundary?.[3];
  const aspect = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  // xeokit Ortho.scale describes the longer viewport dimension, not always its height.
  return Math.max(projectedSpan(right) / Math.min(aspect, 1),
    projectedSpan(up) * Math.max(aspect, 1), 0.01) * 1.15;
}

export function createCameraController(viewer) {
  return Object.freeze({
    fit(identifiers = []) {
      const aabb = getAabb(viewer, identifiers);
      if (!aabb) return;
      fitAabb(viewer, aabb);
    },
    set(payload) {
      ["eye", "look", "up"].forEach((key) => {
        if (Array.isArray(payload?.[key]) && payload[key].length === 3) viewer.camera[key] = payload[key];
      });
      if (["perspective", "ortho"].includes(payload?.projection)) {
        viewer.camera.projection = payload.projection;
      }
      viewer.scene.render(true);
    },
    view(name) {
      const preset = VIEW_PRESETS[name] || VIEW_PRESETS.iso;
      const aabb = getAabb(viewer);
      if (!aabb) return;

      const look = getAabbCenter(aabb);
      const distance = getCameraDistance(aabb);
      const direction = normalizeDirection(preset.direction);
      const eye = direction.map((value, index) => look[index] + value * distance);
      if (name === "iso") {
        viewer.camera.eye = eye;
        viewer.camera.look = look;
        viewer.camera.up = preset.up;
        viewer.camera.projection = preset.projection;
        if (viewer.cameraControl) viewer.cameraControl.pivotPos = look;
        fitAabb(viewer, aabb);
        return;
      }
      viewer.cameraFlight.flyTo({
        eye,
        look,
        up: preset.up,
        projection: preset.projection,
        orthoScale: getPresetOrthoScale(viewer, aabb, direction, preset.up),
        duration: 0.6,
      });
    },
    navigation(mode) {
      if (!viewer.cameraControl) return;
      if (mode === "orbit") {
        viewer.cameraControl.navMode = "orbit";
        viewer.cameraControl.followPointer = true;
        viewer.cameraControl.smartPivot = false;
        viewer.cameraControl.constrainVertical = false;
      } else if (["walk", "fly"].includes(mode)) {
        viewer.cameraFlight.stop();
        viewer.camera.projection = "perspective";
        viewer.cameraControl.navMode = "firstPerson";
        viewer.cameraControl.followPointer = false;
        viewer.cameraControl.smartPivot = false;
        viewer.cameraControl.constrainVertical = mode === "walk";
        viewer.cameraControl.keyboardEnabledOnlyIfMouseover = true;
        viewer.cameraControl.keyboardPanRate = mode === "walk" ? 4 : 12;
        viewer.cameraControl.keyboardDollyRate = mode === "walk" ? 8 : 28;
        viewer.cameraControl.keyboardRotationRate = mode === "walk" ? 55 : 85;
        viewer.cameraControl.mouseWheelDollyRate = mode === "walk" ? 10 : 24;
      }
      viewer.scene.render(true);
    },
  });
}
