// SPDX-License-Identifier: AGPL-3.0-only

export function createVisibilityController(viewer) {
  return Object.freeze({
    show: (ids) => viewer.scene.setObjectsVisible(ids, true),
    hide: (ids) => viewer.scene.setObjectsVisible(ids, false),
    isolate(ids) {
      viewer.scene.setObjectsVisible(viewer.scene.objectIds, false);
      viewer.scene.setObjectsVisible(ids, true);
    },
    reset: () => viewer.scene.setObjectsVisible(viewer.scene.objectIds, true),
  });
}
