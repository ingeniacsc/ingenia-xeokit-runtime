// SPDX-License-Identifier: AGPL-3.0-only

const BOUNDARY_INSET_PX = 8;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function makeViewportPanelDraggable(panel, {
  handle,
  host,
  minimumWidth = 256,
  resizeHandle,
} = {}) {
  if (!panel || !handle || !host) {
    return Object.freeze({ clampToBounds: () => {}, destroy: () => {} });
  }

  let pointerId = null;
  let pointerOffset = null;
  let resizeState = null;

  const movePanel = (left, top) => {
    const hostRect = host.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const maxLeft = Math.max(BOUNDARY_INSET_PX, hostRect.width - panelRect.width - BOUNDARY_INSET_PX);
    const maxTop = Math.max(BOUNDARY_INSET_PX, hostRect.height - panelRect.height - BOUNDARY_INSET_PX);
    panel.style.left = `${clamp(left, BOUNDARY_INSET_PX, maxLeft)}px`;
    panel.style.top = `${clamp(top, BOUNDARY_INSET_PX, maxTop)}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  };

  const clampToBounds = () => {
    if (panel.hidden) return;
    const hostRect = host.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const availableWidth = Math.max(0, hostRect.right - BOUNDARY_INSET_PX - panelRect.left);
    if (panelRect.width > availableWidth) panel.style.width = `${availableWidth}px`;
    movePanel(panelRect.left - hostRect.left, panelRect.top - hostRect.top);
  };

  const endDrag = (event) => {
    if (pointerId === null || (event?.pointerId !== undefined && event.pointerId !== pointerId)) return;
    handle.releasePointerCapture?.(pointerId);
    resizeHandle?.releasePointerCapture?.(pointerId);
    pointerId = null;
    pointerOffset = null;
    resizeState = null;
    panel.classList.remove("is-dragging", "is-resizing");
  };

  const moveDrag = (event) => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    if (resizeState) {
      const hostRect = host.getBoundingClientRect();
      const maximumWidth = Math.max(0, hostRect.right - BOUNDARY_INSET_PX - resizeState.left);
      const desiredWidth = resizeState.startWidth + event.clientX - resizeState.startX;
      panel.style.width = `${clamp(desiredWidth, Math.min(resizeState.minimumWidth, maximumWidth), maximumWidth)}px`;
      return;
    }
    if (!pointerOffset) return;
    const hostRect = host.getBoundingClientRect();
    movePanel(event.clientX - hostRect.left - pointerOffset.x, event.clientY - hostRect.top - pointerOffset.y);
  };

  const startDrag = (event) => {
    if (event.button !== 0 || pointerId !== null) return;
    const panelRect = panel.getBoundingClientRect();
    pointerId = event.pointerId;
    pointerOffset = { x: event.clientX - panelRect.left, y: event.clientY - panelRect.top };
    handle.setPointerCapture?.(pointerId);
    panel.classList.add("is-dragging");
    event.preventDefault();
  };

  const startResize = (event) => {
    if (event.button !== 0 || pointerId !== null) return;
    const panelRect = panel.getBoundingClientRect();
    pointerId = event.pointerId;
    pointerOffset = null;
    resizeState = {
      startX: event.clientX,
      startWidth: panelRect.width,
      left: panelRect.left,
      minimumWidth,
    };
    resizeHandle?.setPointerCapture?.(pointerId);
    panel.classList.add("is-resizing");
    event.preventDefault();
  };

  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(clampToBounds) : null;
  resizeObserver?.observe(panel);
  resizeObserver?.observe(host);
  handle.addEventListener("pointerdown", startDrag);
  resizeHandle?.addEventListener("pointerdown", startResize);
  window.addEventListener("pointermove", moveDrag);
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
  window.addEventListener("resize", clampToBounds);

  return Object.freeze({
    clampToBounds,
    destroy() {
      resizeObserver?.disconnect();
      handle.removeEventListener("pointerdown", startDrag);
      resizeHandle?.removeEventListener("pointerdown", startResize);
      window.removeEventListener("pointermove", moveDrag);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      window.removeEventListener("resize", clampToBounds);
    },
  });
}
