// SPDX-License-Identifier: AGPL-3.0-only

export function createCameraController(viewer) {
  const views = {
    iso: { eye: [12, 10, 12], look: [0, 0, 0], up: [0, 1, 0] },
    front: { eye: [0, 0, 12], look: [0, 0, 0], up: [0, 1, 0] },
    back: { eye: [0, 0, -12], look: [0, 0, 0], up: [0, 1, 0] },
    top: { eye: [0, 12, 0], look: [0, 0, 0], up: [0, 0, -1] },
  };
  return Object.freeze({
    fit(identifiers = []) {
      const aabb = identifiers.length ? viewer.scene.getAABB(identifiers) : viewer.scene.getAABB();
      viewer.cameraFlight.flyTo({ aabb, duration: 0.6 });
    },
    set(payload) {
      ["eye", "look", "up"].forEach((key) => {
        if (Array.isArray(payload?.[key]) && payload[key].length === 3) viewer.camera[key] = payload[key];
      });
    },
    view(name) {
      const target = views[name] || views.iso;
      viewer.cameraFlight.flyTo({ ...target, duration: 0.6 });
    },
    navigation(mode) {
      if (["orbit", "firstPerson", "planView"].includes(mode)) viewer.cameraControl.navMode = mode;
    },
  });
}
