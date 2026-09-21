// SPDX-License-Identifier: AGPL-3.0-only

const MAX_VISIBLE_LABELS = 80;

function normalizeAabb(value) {
  const aabb = Array.from(value || []);
  return aabb.length === 6
    && aabb.every((entry) => Number.isFinite(entry))
    && aabb[3] > aabb[0]
    && aabb[4] > aabb[1]
    && aabb[5] > aabb[2]
    ? aabb
    : null;
}
function resolveObjectName(viewer, objectId) {
  const metaObject = viewer?.metaScene?.metaObjects?.[objectId];
  const sceneObject = viewer?.scene?.objects?.[objectId];
  const tokens = String(objectId || "").split("#");
  return String(
    metaObject?.name
      || metaObject?.externalId
      || sceneObject?.name
      || tokens[tokens.length - 1]
      || objectId,
  ).trim();
}

export function buildObjectLabelRows(viewer, identifiers = []) {
  return Array.from(new Set(identifiers.map((value) => String(value || "").trim()).filter(Boolean)))
    .slice(0, MAX_VISIBLE_LABELS)
    .map((objectId) => {
      const sceneObject = viewer?.scene?.objects?.[objectId];
      const aabb = normalizeAabb(sceneObject?.aabb);
      if (!aabb) return null;
      return Object.freeze({
        objectId,
        label: resolveObjectName(viewer, objectId),
        worldPos: [
          (aabb[0] + aabb[3]) / 2,
          aabb[4],
          (aabb[2] + aabb[5]) / 2,
        ],
      });
    })
    .filter(Boolean);
}

export function createObjectLabelsController(viewer, { container } = {}) {
  const host = container || document.querySelector("#viewport-shell") || document.body;
  const overlay = document.createElement("div");
  overlay.className = "ingenia-object-labels-overlay";
  overlay.setAttribute("aria-hidden", "true");
  host.appendChild(overlay);

  let enabled = false;
  let identifiers = [];
  let frameId = 0;
  let destroyed = false;

  function render() {
    if (destroyed) return;
    overlay.replaceChildren();
    if (!enabled) return;
    const canvas = viewer?.scene?.canvas?.canvas;
    const width = canvas?.clientWidth || canvas?.width || 0;
    const height = canvas?.clientHeight || canvas?.height || 0;
    buildObjectLabelRows(viewer, identifiers).forEach((row) => {
      const point = viewer?.camera?.projectWorldPos?.(row.worldPos);
      if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return;
      if (point[0] < -120 || point[0] > width + 120 || point[1] < -80 || point[1] > height + 80) return;
      const label = document.createElement("span");
      label.className = "ingenia-object-label";
      label.textContent = row.label;
      label.style.left = String(Number(point[0])) + "px";
      label.style.top = String(Number(point[1]) - 10) + "px";
      label.dataset.objectId = row.objectId;
      overlay.appendChild(label);
    });
  }

  function scheduleRender() {
    if (frameId || destroyed) return;
    frameId = window.requestAnimationFrame(() => {
      frameId = 0;
      render();
      if (enabled) scheduleRender();
    });
  }

  return Object.freeze({
    mode(nextEnabled, nextIdentifiers = []) {
      enabled = nextEnabled === true;
      identifiers = Array.from(new Set(nextIdentifiers.map((value) => String(value || "").trim()).filter(Boolean)))
        .slice(0, MAX_VISIBLE_LABELS);
      if (enabled) scheduleRender();
      else overlay.replaceChildren();
    },
    clear() {
      enabled = false;
      identifiers = [];
      overlay.replaceChildren();
    },
    destroy() {
      destroyed = true;
      if (frameId) window.cancelAnimationFrame(frameId);
      overlay.remove();
    },
  });
}
