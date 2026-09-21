// SPDX-License-Identifier: AGPL-3.0-only

const COPY = Object.freeze({
  en: Object.freeze({
    close: "Close model tree", emptyStoreys: "The model has no IfcBuilding data for storeys.",
    isolate: (label) => `Isolate ${label}`, noResults: "No matching objects found.",
    panel: "Model tree", results: (count, limited) => `${count} result${count === 1 ? "" : "s"}${limited ? "; showing the first 250" : ""}.`,
    search: "Search model tree", searchClear: "Clear model tree search", title: "Model tree",
    tabs: { models: "Models", containment: "Objects", types: "Classes", storeys: "Storeys" },
    toggle: (label) => `Expand or collapse ${label}`, visibility: (label) => `Show or hide ${label}`,
  }),
  vi: Object.freeze({
    close: "Đóng cây mô hình", emptyStoreys: "Mô hình chưa có dữ liệu IfcBuilding để phân tầng.",
    isolate: (label) => `Hiện riêng ${label}`, noResults: "Không tìm thấy đối tượng phù hợp.",
    panel: "Cây thư mục mô hình", results: (count, limited) => `${count} kết quả${limited ? "; hiển thị 250 kết quả đầu tiên" : ""}.`,
    search: "Tìm trong cây mô hình", searchClear: "Xóa nội dung tìm kiếm", title: "Cây mô hình",
    tabs: { models: "Mô hình", containment: "Đối tượng", types: "Phân loại", storeys: "Tầng" },
    toggle: (label) => `Mở hoặc thu gọn ${label}`, visibility: (label) => `Hiện hoặc ẩn ${label}`,
  }),
});

export function resolveModelTreeCopy(locale) {
  return locale === "en" ? COPY.en : COPY.vi;
}

export function resolveSingleModelTreeSelection(identifiers = []) {
  const safeIdentifiers = Array.from(new Set(identifiers.map((value) => String(value || "").trim()).filter(Boolean)));
  const modelIds = new Set(safeIdentifiers.map((value) => value.split("#", 1)[0]).filter(Boolean));
  if (!safeIdentifiers.length || modelIds.size !== 1) return null;
  return { identifiers: safeIdentifiers, modelVersionId: Array.from(modelIds)[0] };
}

export function decorateModelTreeBody(body, copy) {
  body?.querySelectorAll?.("li").forEach((row) => {
    const label = String(row.querySelector(":scope > span")?.textContent || "").trim() || "BIM";
    const checkbox = row.querySelector(":scope > input[type='checkbox']");
    if (checkbox) checkbox.setAttribute("aria-label", copy.visibility(label));
    const title = row.querySelector(":scope > span");
    if (title) {
      title.tabIndex = 0;
      title.setAttribute("role", "button");
      title.setAttribute("aria-label", copy.isolate(label));
    }
    const toggle = row.querySelector(":scope > a");
    if (toggle) toggle.setAttribute("aria-label", copy.toggle(label));
  });
}

export function bindModelTreeKeyboardNavigation({ bodies, tabs }) {
  const onBodyKeyDown = (event) => {
    if (!event.target?.matches?.("li > span") || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    event.target.click();
  };
  const onTabKeyDown = (event) => {
    const buttons = Array.from(tabs.querySelectorAll("[role='tab']"));
    const index = buttons.indexOf(event.target);
    if (index < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
    buttons[nextIndex]?.click();
  };
  bodies.addEventListener("keydown", onBodyKeyDown);
  tabs.addEventListener("keydown", onTabKeyDown);
  return () => {
    bodies.removeEventListener("keydown", onBodyKeyDown);
    tabs.removeEventListener("keydown", onTabKeyDown);
  };
}
