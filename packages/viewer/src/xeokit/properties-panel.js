// SPDX-License-Identifier: AGPL-3.0-only
import { buildObjectPropertiesSnapshot } from "./object-properties.js";
import { makeViewportPanelDraggable } from "./floating-panel.js";

const SCOPE_COPY = Object.freeze({
  vi: {
    exact: "Các đối tượng cùng loại và thuộc tính kỹ thuật",
    material: "Các đối tượng cùng vật liệu",
    selection: "Các đối tượng đã chọn",
    single: "Đối tượng đang chọn",
    storey: "Các đối tượng cùng tầng",
    system: "Các đối tượng cùng hệ thống",
    tag: "Các đối tượng cùng Mark/Tag",
    type: "Các đối tượng cùng loại IFC",
    visible: "Các đối tượng đang hiển thị",
  },
  en: {
    exact: "Objects with the same type and technical properties",
    material: "Objects with the same material",
    selection: "Selected objects",
    single: "Selected object",
    storey: "Objects on the same storey",
    system: "Objects in the same system",
    tag: "Objects with the same Mark/Tag",
    type: "Objects of the same IFC type",
    visible: "Visible objects",
  },
});

function appendRows(container, rows) {
  rows.forEach(({ label, setName, value }) => {
    const row = document.createElement("tr");
    row.className = "ingenia-properties-row";
    const term = document.createElement("td");
    term.className = "ingenia-properties-label";
    term.textContent = setName ? `${setName} · ${label}` : label;
    term.title = term.textContent;
    const description = document.createElement("td");
    description.className = "ingenia-properties-value";
    description.textContent = value;
    description.title = value;
    row.append(term, description);
    container.appendChild(row);
  });
}

function createPropertiesTable(title, rows, { fieldLabel, valueLabel, emptyText } = {}) {
  const section = document.createElement("section");
  section.className = "ingenia-properties-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.appendChild(heading);

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "ingenia-object-properties-empty";
    empty.textContent = emptyText;
    section.appendChild(empty);
    return section;
  }

  const shell = document.createElement("div");
  shell.className = "ingenia-properties-table-shell";
  const table = document.createElement("table");
  table.className = "ingenia-properties-table";
  const tableHead = document.createElement("thead");
  const headingRow = document.createElement("tr");
  const fieldHeading = document.createElement("th");
  fieldHeading.scope = "col";
  fieldHeading.textContent = fieldLabel;
  const valueHeading = document.createElement("th");
  valueHeading.scope = "col";
  valueHeading.textContent = valueLabel;
  headingRow.append(fieldHeading, valueHeading);
  tableHead.appendChild(headingRow);
  const tableBody = document.createElement("tbody");
  appendRows(tableBody, rows);
  table.append(tableHead, tableBody);
  shell.appendChild(table);
  section.appendChild(shell);
  return section;
}

export function createObjectPropertiesPanel(
  viewer,
  { container, locale = "vi", onBeforeShow, onVisibilityChange, resolveAccess = () => ({}) } = {},
) {
  const isVi = locale === "vi";
  const copy = SCOPE_COPY[isVi ? "vi" : "en"];
  const panel = document.createElement("section");
  panel.className = "ingenia-object-properties ingenia-viewport-panel";
  panel.hidden = true;
  panel.setAttribute("aria-labelledby", "ingenia-object-properties-heading");
  const announcer = document.createElement("div");
  announcer.className = "ingenia-visually-hidden";
  announcer.setAttribute("role", "status");
  announcer.setAttribute("aria-live", "polite");

  const header = document.createElement("header");
  const headerMain = document.createElement("div");
  headerMain.className = "ingenia-panel-header-main";
  const dragHandle = document.createElement("button");
  dragHandle.type = "button";
  dragHandle.className = "ingenia-panel-drag-handle";
  dragHandle.title = isVi ? "Kéo để di chuyển Thuộc tính BIM" : "Drag to move BIM properties";
  dragHandle.setAttribute("aria-label", dragHandle.title);
  dragHandle.setAttribute("data-ingenia-panel-grip", "six-dot");
  const heading = document.createElement("h2");
  heading.id = "ingenia-object-properties-heading";
  heading.textContent = isVi ? "Thuộc tính BIM" : "BIM properties";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "ingenia-object-properties-close";
  close.textContent = "×";
  close.title = isVi ? "Đóng thuộc tính" : "Close properties";
  close.setAttribute("aria-label", close.title);
  headerMain.append(dragHandle, heading);
  header.append(headerMain, close);

  const summary = document.createElement("p");
  summary.className = "ingenia-object-properties-summary";
  const body = document.createElement("div");
  body.className = "ingenia-object-properties-body";
  const resizeHandle = document.createElement("button");
  resizeHandle.type = "button";
  resizeHandle.className = "ingenia-panel-resize-handle";
  resizeHandle.title = isVi ? "Kéo để thay đổi kích thước Thuộc tính BIM" : "Drag to resize BIM properties";
  resizeHandle.setAttribute("aria-label", resizeHandle.title);
  panel.append(header, summary, body, resizeHandle);
  container?.append(panel, announcer);
  const panelDrag = makeViewportPanelDraggable(panel, {
    handle: dragHandle,
    host: container,
    minimumWidth: 256,
    resizeHandle,
  });
  let announceTimer = null;
  let isOpen = false;

  const notifyVisibility = (open) => {
    if (isOpen === open) return;
    isOpen = open;
    onVisibilityChange?.(open);
  };

  const showTechnicalMetadataUnavailable = () => {
    onBeforeShow?.();
    body.replaceChildren();
    summary.textContent = isVi ? "Trạng thái dữ liệu kỹ thuật" : "Technical metadata status";
    const empty = document.createElement("p");
    empty.className = "ingenia-object-properties-empty";
    empty.textContent = isVi
      ? "Dữ liệu kỹ thuật chưa sẵn sàng cho cấu kiện đã chọn."
      : "Technical metadata is not available for the selected object.";
    body.appendChild(empty);
    panel.hidden = false;
    window.requestAnimationFrame(panelDrag.clampToBounds);
    notifyVisibility(true);
    return true;
  };

  const hide = () => {
    const restoreCanvasFocus = panel.contains(document.activeElement);
    panel.hidden = true;
    notifyVisibility(false);
    if (restoreCanvasFocus) viewer?.scene?.canvas?.canvas?.focus?.();
    return false;
  };
  const onKeyDown = (event) => {
    if (event.key === "Escape" && !panel.hidden) hide();
  };
  close.addEventListener("click", hide);
  document.addEventListener("keydown", onKeyDown);

  return Object.freeze({
    show({ identifiers = [], scope = "selection", totalAvailable = 0 } = {}) {
      const normalizedScope = identifiers.length === 1 ? "single" : scope;
      const access = resolveAccess(identifiers[0]);
      if (!access || !Object.values(access).some((value) => value === true)) {
        return showTechnicalMetadataUnavailable();
      }
      const snapshot = buildObjectPropertiesSnapshot(viewer, identifiers, normalizedScope, locale, access);
      if (!snapshot) return hide();
      onBeforeShow?.();
      body.replaceChildren();
      const scopeLabel = copy[normalizedScope] || copy.selection;
      const totalCount = Math.max(snapshot.count, Number(totalAvailable || 0));
      summary.textContent = snapshot.count > 1
        ? `${scopeLabel} · ${snapshot.count.toLocaleString(isVi ? "vi-VN" : "en-US")}${totalCount > snapshot.count ? ` / ${totalCount.toLocaleString(isVi ? "vi-VN" : "en-US")}` : ""}`
        : scopeLabel;

      const identityTitle = snapshot.count > 1
        ? (isVi ? "Cấu kiện đại diện" : "Representative object")
        : (isVi ? "Định danh IFC" : "IFC identity");
      body.appendChild(createPropertiesTable(identityTitle, snapshot.identityRows, {
        fieldLabel: isVi ? "Trường" : "Field",
        valueLabel: isVi ? "Giá trị" : "Value",
        emptyText: isVi ? "Chưa có dữ liệu định danh." : "No identity data is available.",
      }));

      if (snapshot.propertySetsVisible) {
        const propertiesTitle = snapshot.count > 1
          ? (isVi ? "Thuộc tính chung" : "Common properties")
          : "Property Sets / Quantities";
        body.appendChild(createPropertiesTable(propertiesTitle, snapshot.propertyRows, {
          fieldLabel: isVi ? "Trường" : "Field",
          valueLabel: isVi ? "Giá trị" : "Value",
          emptyText: isVi
            ? "Mô hình chưa cung cấp Pset/Qto kỹ thuật cho lựa chọn này."
            : "No technical Pset/Qto data is available for this selection.",
        }));
      }
      if (totalCount > snapshot.count) {
        const note = document.createElement("p");
        note.className = "ingenia-object-properties-note";
        note.textContent = isVi
          ? `Đã chọn ${snapshot.count} trong tổng ${totalCount} đối tượng.`
          : `${snapshot.count} of ${totalCount} objects are selected.`;
        body.appendChild(note);
      }
      panel.hidden = false;
      window.requestAnimationFrame(panelDrag.clampToBounds);
      notifyVisibility(true);
      announcer.textContent = "";
      globalThis.clearTimeout(announceTimer);
      announceTimer = globalThis.setTimeout(() => {
        announcer.textContent = `${heading.textContent}. ${summary.textContent}`;
      }, 0);
      return true;
    },
    hide,
    isOpen: () => isOpen,
    mode(enabled, payload = {}) {
      return enabled ? this.show(payload) : hide();
    },
    destroy() {
      close.removeEventListener("click", hide);
      document.removeEventListener("keydown", onKeyDown);
      globalThis.clearTimeout(announceTimer);
      panelDrag.destroy();
      panel.remove();
      announcer.remove();
    },
  });
}
