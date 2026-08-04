// SPDX-License-Identifier: AGPL-3.0-only

export function createAppearanceController(viewer) {
  return Object.freeze({
    apply({ identifiers = [], options = {} }) {
      if (options.reset) {
        viewer.scene.setObjectsColorized(viewer.scene.colorizedObjectIds, null);
        viewer.scene.setObjectsOpacity(viewer.scene.opacityObjectIds, 1);
        return;
      }
      if (Array.isArray(options.color) && options.color.length === 3) {
        viewer.scene.setObjectsColorized(identifiers, options.color);
      }
      if (Number.isFinite(options.opacity)) {
        viewer.scene.setObjectsOpacity(identifiers, Math.max(0, Math.min(1, options.opacity)));
      }
    },
    dayNight(mode) {
      viewer.scene.canvas.backgroundColor = mode === "night" ? [0.031, 0.184, 0.208] : [0.96, 0.94, 0.88];
      viewer.scene.render(true);
    },
  });
}
