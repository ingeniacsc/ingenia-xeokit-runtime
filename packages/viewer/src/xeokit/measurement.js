// SPDX-License-Identifier: AGPL-3.0-only
import {
  DistanceMeasurementsMouseControl,
  DistanceMeasurementsPlugin,
  DistanceMeasurementsTouchControl,
} from "@xeokit/xeokit-sdk";

const MAX_MEASUREMENT_DISTANCE = 1e9;

function boundedDistance(value) {
  const distance = Number(value);
  if (!Number.isFinite(distance) || distance < 0 || distance > MAX_MEASUREMENT_DISTANCE) return null;
  return Number(distance.toFixed(6));
}

export function createMeasurementController(viewer, { onChanged } = {}) {
  const canvas = viewer.scene.canvas.canvas;
  const container = canvas.parentElement || document.body;
  const plugin = new DistanceMeasurementsPlugin(viewer, {
    container,
    defaultColor: "#007f88",
    zIndex: 1100,
    defaultLabelsOnWires: true,
    defaultXLabelEnabled: true,
    defaultYLabelEnabled: true,
    defaultZLabelEnabled: true,
  });
  const mouseControl = new DistanceMeasurementsMouseControl(plugin, { snapping: true });
  const touchControl = new DistanceMeasurementsTouchControl(plugin, { snapping: true });
  let active = false;

  plugin.on("measurementEnd", (measurement) => {
    const distance = boundedDistance(measurement?.length);
    if (distance === null) return;
    onChanged?.({ status: "complete", distance });
  });

  function clearControls() {
    mouseControl.deactivate();
    touchControl.deactivate();
    plugin.clear();
  }

  return Object.freeze({
    get active() {
      return active;
    },
    mode(enabled) {
      const nextActive = Boolean(enabled);
      if (nextActive === active) return active;
      if (nextActive) {
        plugin.clear();
        mouseControl.activate();
        touchControl.activate();
      } else {
        clearControls();
      }
      active = nextActive;
      return active;
    },
    clear() {
      const wasActive = active;
      clearControls();
      if (wasActive) {
        mouseControl.activate();
        touchControl.activate();
      }
      return true;
    },
    destroy() {
      active = false;
      clearControls();
      mouseControl.destroy();
      touchControl.destroy();
      plugin.destroy();
    },
  });
}
