// SPDX-License-Identifier: AGPL-3.0-only

export function createSelectionController(viewer, onPicked) {
  const canvas = viewer.scene.canvas.canvas;
  const pick = (event) => {
    const rect = canvas.getBoundingClientRect();
    const hit = viewer.scene.pick({ canvasPos: [event.clientX - rect.left, event.clientY - rect.top] });
    if (!hit?.entity?.id) return;
    viewer.scene.setObjectsSelected(viewer.scene.selectedObjectIds, false);
    viewer.scene.setObjectsSelected([hit.entity.id], true);
    onPicked?.({ identifiers: [hit.entity.id] });
  };
  canvas.addEventListener("click", pick);
  return Object.freeze({
    select(identifiers) {
      viewer.scene.setObjectsSelected(viewer.scene.selectedObjectIds, false);
      viewer.scene.setObjectsSelected(identifiers, true);
    },
    clear() { viewer.scene.setObjectsSelected(viewer.scene.selectedObjectIds, false); },
    destroy() { canvas.removeEventListener("click", pick); },
  });
}
