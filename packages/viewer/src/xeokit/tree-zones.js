// SPDX-License-Identifier: AGPL-3.0-only
import { buildZoneTreeGroups } from "./zone-groups.js";

function branch(label, objectIds, copy, onFocus) {
  const item = document.createElement("li");
  const row = document.createElement("div");
  row.className = "ingenia-model-tree-storey-row";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "ingenia-model-tree-disclosure";
  toggle.textContent = "+";
  toggle.setAttribute("aria-label", copy.toggle(label));
  toggle.setAttribute("aria-expanded", "false");
  const children = document.createElement("ul");
  children.hidden = true;
  toggle.addEventListener("click", () => {
    children.hidden = !children.hidden;
    toggle.textContent = children.hidden ? "+" : "−";
    toggle.setAttribute("aria-expanded", String(!children.hidden));
  });
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ingenia-model-tree-storey-button";
  button.textContent = `${label} (${objectIds.length})`;
  button.title = copy.isolate(label);
  button.setAttribute("aria-label", button.title);
  button.addEventListener("click", () => onFocus(objectIds));
  row.append(toggle, button);
  item.append(row, children);
  return { item, children, toggle };
}

export function renderZoneTree(body, models, { viewer, copy, onFocus, onReset, onCancel }) {
  body.replaceChildren();
  const status = document.createElement("p");
  status.className = "ingenia-model-tree-search-status";
  status.setAttribute("role", "status");
  const groups = buildZoneTreeGroups(viewer, models, copy.unknownStorey);
  const unavailable = models.some((model) => model.zoneGroups == null);
  status.textContent = unavailable ? copy.zonesUnavailable : groups.length ? copy.zonesHint : copy.emptyZones;
  body.appendChild(status);
  if (!groups.length) return () => {};
  const progress = document.createElement("p");
  progress.className = "ingenia-model-tree-search-status";
  progress.setAttribute("role", "status");
  progress.setAttribute("aria-live", "polite");
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "ingenia-model-tree-storey-button";
  cancel.textContent = copy.cancelZoneFilter;
  cancel.hidden = true;
  cancel.addEventListener("click", onCancel);
  body.append(progress, cancel);
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "ingenia-model-tree-storey-button";
  reset.textContent = copy.clearZoneFilter;
  reset.addEventListener("click", onReset);
  body.appendChild(reset);
  const list = document.createElement("ul");
  for (const group of groups) {
    const label = `${group.code} · ${group.name} — ${group.displayName || group.modelId}`;
    const zone = branch(label, group.objectIds, copy, onFocus);
    zone.item.dataset.modelTreeZone = "true";
    zone.item.dataset.modelTreeZoneSearch = [label, ...group.storeys.flatMap((s) => [s.label, ...s.types.keys()])].join(" ");
    for (const storey of group.storeys) {
      const floor = branch(storey.label, storey.objectIds, copy, onFocus);
      for (const [type, ids] of [...storey.types].sort(([a], [b]) => a.localeCompare(b))) {
        const leaf = branch(type, ids, copy, onFocus);
        leaf.toggle.hidden = true;
        floor.children.appendChild(leaf.item);
      }
      zone.children.appendChild(floor.item);
    }
    list.appendChild(zone.item);
  }
  body.appendChild(list);
  return ({ phase, processed, total }) => {
    const busy = phase === "prepare" || phase === "apply";
    body.setAttribute("aria-busy", String(busy));
    cancel.hidden = !busy;
    progress.textContent = busy ? copy.zoneProgress(processed, total)
      : phase === "cancelled" ? copy.zoneCancelled : phase === "error" ? copy.zoneFailed : copy.zoneComplete(total);
  };
}
