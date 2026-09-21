// SPDX-License-Identifier: AGPL-3.0-only

export function createVisibilityController(viewer, { isObjectAllowed = () => true } = {}) {
  const manuallyHiddenIds = new Set();
  let applying = false;
  const visibilitySubscription = viewer.scene.on?.("objectVisibility", (entity) => {
    if (applying || !entity?.id) return;
    if (entity.visible === false) manuallyHiddenIds.add(entity.id);
    else manuallyHiddenIds.delete(entity.id);
  });

  function setVisible(ids, visible, { trackManual = true } = {}) {
    const existingObjectIds = Array.from(new Set((ids || []).filter((id) => viewer.scene.objects?.[id])));
    const objectIds = visible ? existingObjectIds.filter((id) => isObjectAllowed(id)) : existingObjectIds;
    const deniedObjectIds = visible ? existingObjectIds.filter((id) => !isObjectAllowed(id)) : [];
    applying = true;
    viewer.scene.setObjectsVisible(objectIds, visible);
    if (deniedObjectIds.length > 0) viewer.scene.setObjectsVisible(deniedObjectIds, false);
    applying = false;
    if (trackManual) {
      objectIds.forEach((id) => {
        if (visible) manuallyHiddenIds.delete(id);
        else manuallyHiddenIds.add(id);
      });
    }
    return objectIds;
  }

  return Object.freeze({
    show: (ids) => setVisible(ids, true),
    hide: (ids) => setVisible(ids, false),
    isolate(ids) {
      setVisible(viewer.scene.objectIds, false);
      setVisible(ids, true);
    },
    reset: () => {
      setVisible(viewer.scene.objectIds, true, { trackManual: false });
      manuallyHiddenIds.clear();
      Object.values(viewer.scene.objects || {}).forEach((entity) => {
        if (entity && 'xrayed' in entity) entity.xrayed = false;
      });
      viewer.scene.render(true);
    },
    reapply() {
      const retained = [...manuallyHiddenIds].filter((id) => viewer.scene.objects?.[id]);
      manuallyHiddenIds.clear();
      retained.forEach((id) => manuallyHiddenIds.add(id));
      setVisible(retained, false);
    },
    hideTransient: (ids) => setVisible(ids, false, { trackManual: false }),
    restoreTransient: (ids) => setVisible(
      (ids || []).filter((id) => !manuallyHiddenIds.has(id)),
      true,
      { trackManual: false },
    ),
    hiddenObjectIds: () => [...manuallyHiddenIds],
    destroy() {
      if (visibilitySubscription) viewer.scene.off?.(visibilitySubscription);
      manuallyHiddenIds.clear();
    },
  });
}
