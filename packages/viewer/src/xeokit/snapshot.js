// SPDX-License-Identifier: AGPL-3.0-only

export function createSnapshotController(viewer) {
  return Object.freeze({
    capture(options = {}) {
      return viewer.getSnapshot({
        width: Math.min(Number(options.width) || 1920, 4096),
        height: Math.min(Number(options.height) || 1080, 4096),
        format: "png",
        includeGizmos: false,
      });
    },
  });
}
