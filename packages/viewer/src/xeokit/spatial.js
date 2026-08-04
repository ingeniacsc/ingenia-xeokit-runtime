// SPDX-License-Identifier: AGPL-3.0-only
import { SectionPlanesPlugin } from "@xeokit/xeokit-sdk";

export function createSpatialController(viewer) {
  const sectionPlanes = new SectionPlanesPlugin(viewer, { overviewVisible: false });
  const planes = new Map();
  return Object.freeze({
    setSection({ id = "primary-section", pos = [0, 0, 0], dir = [0, -1, 0] }) {
      planes.get(id)?.destroy?.();
      planes.set(id, sectionPlanes.createSectionPlane({ id, pos, dir }));
    },
    clearSection({ id } = {}) {
      if (id) {
        planes.get(id)?.destroy?.();
        planes.delete(id);
      } else {
        planes.forEach((plane) => plane.destroy?.());
        planes.clear();
      }
    },
    destroy() { sectionPlanes.destroy(); },
  });
}
