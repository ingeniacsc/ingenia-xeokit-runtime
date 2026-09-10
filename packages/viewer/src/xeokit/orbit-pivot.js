// SPDX-License-Identifier: AGPL-3.0-only

const PIVOT_MARKER_DURATION_MS = 1400;

function finiteWorldPosition(value) {
  const position = Array.from(value || []);
  return position.length === 3 && position.every(Number.isFinite) ? position : null;
}
export function createOrbitPivotController(viewer, {
  canvas = viewer?.scene?.canvas?.canvas,
  marker,
  timerTarget = window,
} = {}) {
  let enabled = false;
  let markerTimeout = null;

  function hideMarker() {
    if (marker) marker.hidden = true;
  }

  function showMarker(canvasPos) {
    if (!marker || !Array.isArray(canvasPos) || canvasPos.length !== 2) return;
    marker.style.left = `${canvasPos[0]}px`;
    marker.style.top = `${canvasPos[1]}px`;
    marker.hidden = false;
    if (markerTimeout) timerTarget.clearTimeout(markerTimeout);
    markerTimeout = timerTarget.setTimeout(() => {
      markerTimeout = null;
      hideMarker();
    }, PIVOT_MARKER_DURATION_MS);
  }

  return Object.freeze({
    setEnabled(nextEnabled) {
      enabled = nextEnabled === true;
      if (!enabled) {
        if (markerTimeout) timerTarget.clearTimeout(markerTimeout);
        markerTimeout = null;
        hideMarker();
      }
      return enabled;
    },
    setFromPointerEvent(event) {
      const cameraControl = viewer?.cameraControl;
      if (!enabled || !cameraControl || cameraControl.navMode !== "orbit" || !canvas) return false;
      const rect = canvas.getBoundingClientRect();
      const canvasPos = [event.clientX - rect.left, event.clientY - rect.top];
      const hit = viewer.scene?.pick?.({ canvasPos, pickSurface: true });
      const worldPos = finiteWorldPosition(hit?.worldPos);
      if (!worldPos) return false;

      cameraControl.followPointer = true;
      cameraControl.smartPivot = false;
      cameraControl.pivotPos = worldPos;
      showMarker(canvasPos);
      return true;
    },
    destroy() {
      if (markerTimeout) timerTarget.clearTimeout(markerTimeout);
      markerTimeout = null;
      hideMarker();
    },
  });
}
