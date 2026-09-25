// SPDX-License-Identifier: AGPL-3.0-only

// Extract the rectangle's six world-space planes from the active projection.
// This works for both perspective and orthographic cameras, without point sampling.
export function createMarqueeIntersection(scene, rectangle) {
  const view = scene.camera?.viewMatrix;
  const projection = scene.camera?.projMatrix;
  const bounds = scene.canvas.canvas.getBoundingClientRect();
  if (view?.length !== 16 || projection?.length !== 16
      || !Array.from(view).every(Number.isFinite) || !Array.from(projection).every(Number.isFinite)
      || !(bounds.width > 0 && bounds.height > 0)) return () => false;
  const matrix = new Float64Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let index = 0; index < 4; index += 1) {
        matrix[column * 4 + row] += projection[index * 4 + row] * view[column * 4 + index];
      }
    }
  }
  const left = rectangle.left / bounds.width * 2 - 1;
  const right = rectangle.right / bounds.width * 2 - 1;
  const top = 1 - rectangle.top / bounds.height * 2;
  const bottom = 1 - rectangle.bottom / bounds.height * 2;
  const plane = (axis, sign, offset) => Array.from({ length: 4 }, (_, i) => (
    sign * matrix[i * 4 + axis] + offset * matrix[i * 4 + 3]
  ));
  const planes = [plane(0, 1, -left), plane(0, -1, right),
    plane(1, 1, -bottom), plane(1, -1, top), plane(2, 1, 1), plane(2, -1, 1)];
  const clippingPlanes = Object.values(scene.sectionPlanes || {}).filter((p) => p.active).map((p) => (
    [-p.dir[0], -p.dir[1], -p.dir[2], p.dir[0] * p.pos[0] + p.dir[1] * p.pos[1] + p.dir[2] * p.pos[2]]
  ));
  const outside = (aabb, p) => (
    p[0] * aabb[p[0] >= 0 ? 3 : 0] + p[1] * aabb[p[1] >= 0 ? 4 : 1]
      + p[2] * aabb[p[2] >= 0 ? 5 : 2] + p[3] < -1e-7
  );
  return (entity) => {
    const aabb = entity?.aabb;
    if (!entity || entity.visible === false || entity.pickable === false || entity.culled === true
        || !aabb || aabb.length !== 6) return false;
    for (let index = 0; index < 6; index += 1) if (!Number.isFinite(aabb[index])) return false;
    for (let index = 0; index < 3; index += 1) if (aabb[index] > aabb[index + 3]) return false;
    return !planes.some((p) => outside(aabb, p))
      && (entity.clippable === false || !clippingPlanes.some((p) => outside(aabb, p)));
  };
}

export function createMarqueeGesture(viewer, {
  keyboardTarget,
  isInteractionCaptured,
  onStart,
  onSelect,
  onCancel,
  onClick,
}) {
  const canvas = viewer.scene.canvas.canvas;
  let drag = null;
  let overlay = null;
  let suppressClick = false;
  const position = (event) => {
    const bounds = canvas.getBoundingClientRect();
    return [Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      Math.max(0, Math.min(bounds.height, event.clientY - bounds.top))];
  };
  const rectangle = (end) => ({
    left: Math.min(drag.start[0], end[0]), top: Math.min(drag.start[1], end[1]),
    right: Math.max(drag.start[0], end[0]), bottom: Math.max(drag.start[1], end[1]),
  });
  const cleanup = () => {
    if (!drag) return;
    const previous = drag;
    drag = null;
    if (viewer.cameraControl) viewer.cameraControl.pointerEnabled = previous.pointerEnabled;
    if (canvas.style) canvas.style.cursor = previous.cursor;
    if (canvas.hasPointerCapture?.(previous.id)) canvas.releasePointerCapture?.(previous.id);
    overlay?.remove();
    overlay = null;
  };
  const cancel = () => {
    if (!drag) return;
    suppressClick = true;
    cleanup();
    onCancel?.();
  };
  const down = (event) => {
    suppressClick = false;
    if (drag || event.button !== 0 || (event.pointerType && event.pointerType !== 'mouse')
        || !(event.ctrlKey || event.metaKey) || event.shiftKey || isInteractionCaptured?.()) return;
    drag = { id: event.pointerId, start: position(event), event, moved: false,
      pointerEnabled: viewer.cameraControl?.pointerEnabled, cursor: canvas.style?.cursor || '' };
    if (viewer.cameraControl) viewer.cameraControl.pointerEnabled = false;
    if (canvas.style) canvas.style.cursor = 'crosshair';
    canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault?.();
    onStart?.();
  };
  const move = (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    if (isInteractionCaptured?.()) { cancel(); return; }
    const end = position(event);
    if (Math.hypot(end[0] - drag.start[0], end[1] - drag.start[1]) < 4 && !drag.moved) return;
    drag.moved = true;
    const box = rectangle(end);
    const document = canvas.ownerDocument;
    if (!overlay && document?.body) {
      overlay = document.createElement('div');
      overlay.setAttribute('data-viewer-marquee', '');
      overlay.setAttribute('aria-hidden', 'true');
      Object.assign(overlay.style, { position: 'fixed', pointerEvents: 'none', zIndex: '100',
        border: '1px solid #007e91', background: 'rgba(0, 126, 145, .15)' });
      document.body.appendChild(overlay);
    }
    if (overlay) {
      const bounds = canvas.getBoundingClientRect();
      Object.assign(overlay.style, { left: `${bounds.left + box.left}px`, top: `${bounds.top + box.top}px`,
        width: `${box.right - box.left}px`, height: `${box.bottom - box.top}px` });
    }
    event.preventDefault?.();
  };
  const up = (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    move(event);
    if (!drag) return;
    const previous = drag;
    const box = rectangle(position(event));
    suppressClick = true;
    cleanup();
    // Preventing pointerdown suppresses compatibility mouse events in browsers.
    // Handle a stationary Ctrl click here, then swallow its optional synthetic click.
    if (previous.moved) onSelect?.(box, previous.event);
    else onClick?.(previous.event);
  };
  const cancelled = (event) => { if (drag?.id === event.pointerId) cancel(); };
  const keydown = (event) => {
    if (event.key !== 'Escape' || !drag) return;
    event.preventDefault?.();
    cancel();
  };
  canvas.addEventListener('pointerdown', down, true);
  canvas.addEventListener('pointermove', move, true);
  canvas.addEventListener('pointerup', up, true);
  canvas.addEventListener('pointercancel', cancelled, true);
  canvas.addEventListener('lostpointercapture', cancelled, true);
  keyboardTarget?.addEventListener?.('keydown', keydown, true);
  keyboardTarget?.addEventListener?.('blur', cancel);
  return {
    cancel,
    consumeClick() {
      const suppressed = suppressClick;
      suppressClick = false;
      return suppressed;
    },
    destroy() {
      cancel();
      canvas.removeEventListener('pointerdown', down, true);
      canvas.removeEventListener('pointermove', move, true);
      canvas.removeEventListener('pointerup', up, true);
      canvas.removeEventListener('pointercancel', cancelled, true);
      canvas.removeEventListener('lostpointercapture', cancelled, true);
      keyboardTarget?.removeEventListener?.('keydown', keydown, true);
      keyboardTarget?.removeEventListener?.('blur', cancel);
    },
  };
}
