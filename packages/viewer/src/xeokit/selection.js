// SPDX-License-Identifier: AGPL-3.0-only

const TOUCH_PICK_MAX_DISTANCE_PX = 12;
const TOUCH_PICK_CLICK_DEDUPLICATION_MS = 750;

export function createSelectionController(viewer, onPicked) {
  let touchPointerStart = null;
  let lastTouchPick = null;
  const canvas = viewer.scene.canvas.canvas;
  const pick = (event) => {
    const rect = canvas.getBoundingClientRect();
    const hit = viewer.scene.pick({ canvasPos: [event.clientX - rect.left, event.clientY - rect.top] });
    if (!hit?.entity?.id) return;
    viewer.scene.setObjectsSelected(viewer.scene.selectedObjectIds, false);
    viewer.scene.setObjectsSelected([hit.entity.id], true);
    onPicked?.({ identifiers: [hit.entity.id] });
  };
  const shouldIgnoreSyntheticTouchClick = (event) => {
    if (!lastTouchPick) return false;
    const elapsed = Date.now() - lastTouchPick.at;
    if (elapsed < 0 || elapsed > TOUCH_PICK_CLICK_DEDUPLICATION_MS) return false;
    const deltaX = Number(event.clientX) - lastTouchPick.x;
    const deltaY = Number(event.clientY) - lastTouchPick.y;
    return Math.hypot(deltaX, deltaY) <= TOUCH_PICK_MAX_DISTANCE_PX;
  };
  const onCanvasClick = (event) => {
    if (shouldIgnoreSyntheticTouchClick(event)) return;
    pick(event);
  };
  const onPointerDown = (event) => {
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      touchPointerStart = {
        id: event.pointerId,
        x: Number(event.clientX) || 0,
        y: Number(event.clientY) || 0,
      };
    }
  };
  const onPointerUp = (event) => {
    if (!touchPointerStart || touchPointerStart.id !== event.pointerId) return;
    const start = touchPointerStart;
    touchPointerStart = null;
    const x = Number(event.clientX) || 0;
    const y = Number(event.clientY) || 0;
    if (Math.hypot(x - start.x, y - start.y) > TOUCH_PICK_MAX_DISTANCE_PX) return;
    lastTouchPick = { at: Date.now(), x, y };
    pick(event);
  };
  const onPointerCancel = (event) => {
    if (touchPointerStart?.id === event.pointerId) touchPointerStart = null;
  };
  canvas.addEventListener('click', onCanvasClick);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  return Object.freeze({
    select(identifiers) {
      viewer.scene.setObjectsSelected(viewer.scene.selectedObjectIds, false);
      viewer.scene.setObjectsSelected(identifiers, true);
    },
    clear() { viewer.scene.setObjectsSelected(viewer.scene.selectedObjectIds, false); },
    destroy() {
      canvas.removeEventListener('click', onCanvasClick);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
    },
  });
}
