// SPDX-License-Identifier: AGPL-3.0-only
import { Mesh, PhongMaterial, ReadableGeometry, SectionPlane } from "@xeokit/xeokit-sdk";
import { AXIS_PREVIEW_COLORS, buildAxisRangePreview } from "./axis-range-preview-geometry.js";

// An owned preview: no model visibility, selection, permissions or other planes change.
export function createAxisRangePreview(viewer, { container, locale = "vi" } = {}) {
  const scene = viewer.scene;
  const document = container?.ownerDocument;
  const window = document?.defaultView;
  let descriptor = null, overlay = null, frameId = 0, destroyed = false;
  let planes = [], wires = [], labels = [], subscriptions = [];
  const labelsVi = locale === "vi";

  function renderLabels() {
    frameId = 0;
    if (!descriptor || destroyed || !overlay) return;
    const canvas = scene.canvas?.canvas;
    const canvasRect = canvas?.getBoundingClientRect?.();
    const hostRect = container.getBoundingClientRect();
    if (!canvasRect || !canvasRect.width || !canvasRect.height) return;
    const eye = viewer.camera.eye, look = viewer.camera.look;
    descriptor.planes.forEach((plane, index) => {
      const label = labels[index];
      const point = viewer.camera.projectWorldPos(plane.pos);
      const ahead = !eye || !look || plane.pos.reduce((sum, value, i) =>
        sum + (value - eye[i]) * (look[i] - eye[i]), 0) > 0;
      const visible = ahead && point && Number.isFinite(point[0]) && Number.isFinite(point[1])
        && point[0] >= 0 && point[0] <= canvasRect.width
        && point[1] >= 0 && point[1] <= canvasRect.height;
      label.hidden = !visible;
      if (!visible) return;
      label.style.left = `${point[0] + canvasRect.left - hostRect.left}px`;
      label.style.top = `${point[1] + canvasRect.top - hostRect.top}px`;
    });
  }
  function scheduleLabels() {
    if (!descriptor || destroyed || frameId || !window) return;
    frameId = window.requestAnimationFrame(renderLabels);
  }
  function subscribe(target, event) {
    const handle = target?.on?.(event, scheduleLabels);
    if (handle !== undefined && handle !== null) subscriptions.push([target, handle]);
  }
  function clear() {
    descriptor = null;
    if (frameId) window?.cancelAnimationFrame(frameId);
    frameId = 0;
    subscriptions.forEach(([target, handle]) => target.off(handle)); subscriptions = [];
    planes.forEach((plane) => plane.destroy()); planes = [];
    wires.forEach(({ mesh, geometry, material }) => {
      mesh?.destroy(); geometry?.destroy(); material?.destroy();
    }); wires = [];
    overlay?.remove(); overlay = null; labels = [];
  }
  function create() {
    // Components use SDK-generated IDs, so independent tools never share ownership.
    descriptor.planes.forEach((plane) => planes.push(new SectionPlane(scene, { ...plane, active: true })));
    descriptor.wires.forEach(({ axis, positions, indices }) => {
      const color = AXIS_PREVIEW_COLORS[axis];
      const resource = {}; wires.push(resource);
      const geometry = resource.geometry = new ReadableGeometry(scene, { primitive: "lines", positions, indices });
      const material = resource.material = new PhongMaterial(scene, {
        diffuse: [0, 0, 0], emissive: color, ambient: color, lineWidth: 2,
      });
      resource.mesh = new Mesh(scene, { geometry, material, isObject: false,
        pickable: false, collidable: false, clippable: false, castsShadow: false, receivesShadow: false });
    });
    if (document && container) {
      overlay = document.createElement("div");
      overlay.dataset.axisRangePreview = "true";
      overlay.setAttribute("aria-hidden", "true");
      Object.assign(overlay.style, { position: "absolute", inset: "0", pointerEvents: "none", overflow: "hidden" });
      labels = descriptor.planes.map(({ axis, side }) => {
        const label = document.createElement("span");
        label.dataset.axisRangeFace = `${axis}-${side ? "max" : "min"}`;
        const color = `rgb(${AXIS_PREVIEW_COLORS[axis].map((value) => Math.round(value * 255)).join(",")})`;
        Object.assign(label.style, { position: "absolute", transform: "translate(-50%, -50%)",
          color, background: "rgba(255,255,255,0.94)", border: `1px solid ${color}`,
          borderRadius: "4px", padding: "3px 5px", whiteSpace: "nowrap", font: "600 12px sans-serif" });
        overlay.appendChild(label); return label;
      });
      container.appendChild(overlay);
      subscribe(viewer.camera, "viewMatrix"); subscribe(viewer.camera, "projMatrix");
      subscribe(scene.canvas, "boundary");
    }
  }
  return Object.freeze({
    update(spec) {
      if (destroyed) return;
      if (!spec) { clear(); return; }
      let next;
      try { next = buildAxisRangePreview(spec); }
      catch (error) { clear(); throw error; }
      descriptor = next;
      try {
        if (!planes.length) create();
        else {
          planes.forEach((plane, index) => {
            plane.pos = descriptor.planes[index].pos;
            plane.dir = descriptor.planes[index].dir;
          });
          wires.forEach(({ geometry }, index) => { geometry.positions = descriptor.wires[index].positions; });
        }
        labels.forEach((label, index) => {
          const plane = descriptor.planes[index];
          const value = Math.abs(plane.value) < 0.0005 ? 0 : plane.value;
          label.textContent = `${plane.axis.toUpperCase()} ${labelsVi
            ? (plane.side ? "\u0110\u1ebfn" : "T\u1eeb") : (plane.side ? "Max" : "Min")} = ${value.toFixed(3)} m`;
        });
        scheduleLabels();
      } catch (error) { clear(); throw error; }
    },
    clear,
    destroy() { clear(); destroyed = true; },
  });
}
