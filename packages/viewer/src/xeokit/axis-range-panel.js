// SPDX-License-Identifier: AGPL-3.0-only

const COPY = {
  vi: {
    preview: "Xem tr\u01b0\u1edbc m\u1eb7t c\u1eaft XYZ", slider: "Thanh tr\u01b0\u1ee3t", modelBounds: "Gi\u1edbi h\u1ea1n m\u00f4 h\u00ecnh (m)",
    localHint: "T\u1ecda \u0111\u1ed9 n\u1ed9i b\u1ed9 m\u00f4 h\u00ecnh; kh\u00f4ng ph\u1ea3i t\u1ecda \u0111\u1ed9 b\u1ea3n \u0111\u1ed3.",
    gridHint: "X/Y theo l\u01b0\u1edbi tr\u1ee5c \u0111\u00e3 x\u00e1c minh; Z l\u00e0 cao \u0111\u1ed9 m\u00f4 h\u00ecnh (m).",
    previewHint: "M\u1eb7t c\u1eaft di chuy\u1ec3n theo gi\u00e1 tr\u1ecb X/Y/Z. Xem tr\u01b0\u1edbc ch\u01b0a l\u1ecdc ho\u1eb7c ch\u1ecdn c\u1ea5u ki\u1ec7n.",
    model: "Mô hình", system: "Hệ tọa độ", local: "XYZ mô hình (m)", mode: "Cách lấy cấu kiện",
    contained: "Nằm hoàn toàn trong vùng", intersects: "Giao với vùng", from: "Từ", to: "Đến",
    axis: "Trục", offset: "Độ lệch (m)", choose: "Chọn trục", apply: "Chỉ hiển thị vùng",
    select: "Chọn tất cả trong vùng", clear: "Bỏ lọc", cancel: "Hủy xử lý",
    hint: "Lọc theo hộp bao cấu kiện, có thể lấy dư tại ranh. X, Y là mặt bằng; Z là cao độ (m). Sau khi lọc, chọn thủ công hoặc chọn tất cả rồi dùng Sao chép GUID để gán Zone trong BIM Admin. Không tự ghi vào Zone.",
    noGrid: "Chưa có lưới trục đã xác minh cho mô hình này. Có thể nhập khoảng XYZ trong hệ tọa độ mô hình.",
    noModel: "Chưa có mô hình đã tải để lọc.", invalid: "Nhập đủ khoảng X, Y, Z hợp lệ; giá trị Từ phải nhỏ hơn Đến. Khi dùng lưới, chọn đủ bốn trục ranh.",
    edited: "Khoảng đã thay đổi. Bấm Chỉ hiển thị vùng để cập nhật kết quả.",
    cancelled: "Đã hủy xử lý.", failed: "Không thể lọc vùng. Kiểm tra mô hình và hệ tọa độ rồi thử lại.",
    cleared: "Đã bỏ lọc vùng.", selected: "Đã chọn tập cấu kiện trong vùng. Dùng Sao chép GUID để tiếp tục.",
    progress: (done, total) => `Đang xử lý ${done}/${total} cấu kiện…`,
    result: (count, missing, boundary) => `${count} cấu kiện trong vùng; ${boundary} giao ranh; ${missing} thiếu hộp bao.`,
  },
  en: {
    preview: "Preview XYZ section planes", slider: "Slider", modelBounds: "Model bounds (m)",
    localHint: "Local model coordinates; not map coordinates.",
    gridHint: "X/Y follow the verified grid; Z is model elevation (m).",
    previewHint: "Section planes move with X/Y/Z values. Preview does not filter or select elements.",
    model: "Model", system: "Coordinate system", local: "Model XYZ (m)", mode: "Element matching",
    contained: "Fully inside region", intersects: "Intersecting region", from: "From", to: "To",
    axis: "Grid axis", offset: "Offset (m)", choose: "Select axis", apply: "Show only region",
    select: "Select all in region", clear: "Clear filter", cancel: "Cancel processing",
    hint: "Uses element bounding boxes; boundary matches may include extra elements. X and Y are plan coordinates; Z is elevation (m). After filtering, select manually or select all, then use Copy GUID to assign a Zone in BIM Admin. No Zone is saved automatically.",
    noGrid: "No verified grid is available for this model. Enter XYZ ranges in model coordinates instead.",
    noModel: "No loaded model is available to filter.", invalid: "Enter valid X, Y and Z ranges with From smaller than To. Grid mode requires all four boundary axes.",
    edited: "Range changed. Apply Show only region to update the result.",
    cancelled: "Processing cancelled.", failed: "Unable to filter this region. Check the model and coordinate system and try again.",
    cleared: "Region filter cleared.", selected: "Region elements selected. Use Copy GUID to continue.",
    progress: (done, total) => `Processing ${done}/${total} elements…`,
    result: (count, missing, boundary) => `${count} elements in region; ${boundary} cross the boundary; ${missing} have no bounding box.`,
  },
};

function finiteInput(value) {
  if (value === "" || value == null || !String(value).trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Resolve all six boundaries together. Named axes are usable only from supplied verified options. */
export function resolveAxisRangeInput({ modelId, values, mode, system }) {
  if (!modelId || !["contained", "intersects"].includes(mode)) return null;
  const bounds = {};
  for (const axis of ["x", "y", "z"]) {
    bounds[axis] = [0, 1].map((side) => {
      const entry = values[axis]?.[side];
      if (system && axis !== "z") {
        const anchor = system[`${axis}Axes`]?.find((item) => item.id === entry?.axisId);
        const offset = finiteInput(entry?.offset);
        return anchor && Number.isFinite(anchor.value) && offset != null ? anchor.value + offset : null;
      }
      return finiteInput(entry?.value);
    });
    if (bounds[axis].some((value) => value == null || !Number.isFinite(value)) || bounds[axis][0] >= bounds[axis][1]) return null;
  }
  return { modelId, bounds, mode, ...(system ? { frame: system.frame } : {}) };
}

export function createAxisRangePanel(body, {
  locale = "vi", getModels, getGridOptions = () => [], getModelBounds = () => null,
  onApply, onSelectAll, onClear, onCancel, onPreview,
}) {
  const copy = COPY[locale === "vi" ? "vi" : "en"];
  const doc = body.ownerDocument || document;
  let destroyed = false;
  let generation = 0;
  let busy = false;
  let hasResult = false;
  let signature = null;
  let systems = [];
  let modelBounds = null;
  const values = {};
  const legends = {};
  const listeners = [];
  const element = (tag, text) => {
    const node = doc.createElement(tag);
    if (text != null) node.textContent = text;
    return node;
  };
  const listen = (node, event, handler) => {
    node.addEventListener(event, handler);
    listeners.push(() => node.removeEventListener(event, handler));
  };
  const root = element("section");
  root.className = "ingenia-axis-range-panel";
  root.style.cssText = "display:grid;gap:10px;padding:8px;font-size:12px;line-height:1.45;";
  const field = (text, control, parent = root) => {
    const label = element("label");
    label.style.cssText = "display:grid;gap:4px;min-width:0;";
    label.append(element("span", text), control);
    control.setAttribute("aria-label", text);
    control.style.cssText = "min-width:0;width:100%;box-sizing:border-box;padding:6px;color:inherit;background:rgba(255,255,255,.85);border:1px solid #a8b9b8;border-radius:6px;";
    parent.append(label);
  };
  const option = (select, value, label) => {
    const node = element("option", label);
    node.value = value;
    select.append(node);
  };
  const modelSelect = element("select");
  field(copy.model, modelSelect);
  const systemSelect = element("select");
  field(copy.system, systemSelect);
  const coordinateNotice = element("p");
  const boundsNotice = element("p");
  const previewToggle = element("input");
  previewToggle.type = "checkbox";
  previewToggle.checked = false;
  const previewLabel = element("label");
  previewLabel.style.cssText = "display:flex;align-items:center;gap:8px;cursor:pointer;";
  previewToggle.setAttribute("aria-label", copy.preview);
  previewLabel.append(previewToggle, element("span", copy.preview));
  listen(previewToggle, "change", () => publishPreview());
  const gridNotice = element("p");
  root.append(coordinateNotice, boundsNotice, previewLabel, element("p", copy.previewHint), gridNotice);
  for (const axis of ["x", "y", "z"]) {
    const group = element("fieldset");
    group.style.cssText = "min-width:0;margin:0;padding:8px;border:1px solid #bdcccb;border-radius:6px;";
    legends[axis] = element("legend", `${axis.toUpperCase()} (m)`);
    const axisColor = { x: "#b63a3a", y: "#227b49", z: "#286bb1" }[axis];
    legends[axis].style.color = axisColor;
    group.append(legends[axis]);
    const columns = element("div");
    columns.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;";
    group.append(columns);
    values[axis] = [0, 1].map((side) => {
      const column = element("div");
      column.style.cssText = "display:grid;gap:6px;";
      columns.append(column);
      const prefix = `${axis.toUpperCase()} ${side ? copy.to : copy.from}`;
      const numeric = element("input");
      numeric.type = "number";
      numeric.step = "0.001";
      field(prefix, numeric, column);
      const slider = element("input");
      slider.type = "range";
      slider.step = "0.001";
      field(`${prefix} \u00b7 ${copy.slider}`, slider, column);
      slider.style.accentColor = axisColor;
      listen(slider, "input", () => {
        numeric.value = slider.value;
        syncSliders(axis);
        invalidate();
        if (previewToggle.checked) publishPreview();
      });
      const anchor = element("select");
      field(`${prefix} · ${copy.axis}`, anchor, column);
      const offset = element("input");
      offset.type = "number";
      offset.step = "any";
      offset.value = "0";
      field(`${prefix} · ${copy.offset}`, offset, column);
      listen(numeric, "input", () => { syncSliders(axis); invalidate(); if (previewToggle.checked) publishPreview(); });
      listen(offset, "input", () => { invalidate(); if (previewToggle.checked) publishPreview(); });
      listen(anchor, "change", () => { invalidate(); if (previewToggle.checked) publishPreview(); });
      return { numeric, slider, anchor, offset };
    });
    root.append(group);
  }
  const modeSelect = element("select");
  option(modeSelect, "contained", copy.contained);
  option(modeSelect, "intersects", copy.intersects);
  modeSelect.value = "contained";
  field(copy.mode, modeSelect);
  listen(modeSelect, "change", invalidate);
  root.append(element("p", copy.hint));
  const status = element("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  root.append(status);
  const actions = element("div");
  actions.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;";
  root.append(actions);
  const button = (text, handler) => {
    const node = element("button", text);
    node.type = "button";
    node.className = "ingenia-model-tree-storey-button";
    listen(node, "click", handler);
    actions.append(node);
    return node;
  };
  const apply = button(copy.apply, async () => {
    setPreviewEnabled(false);
    const payload = readSpec();
    if (!payload) { status.textContent = copy.invalid; return; }
    const current = ++generation;
    busy = true;
    hasResult = false;
    syncButtons();
    status.textContent = copy.progress(0, 0);
    try {
      const result = await onApply(payload);
      if (destroyed || current !== generation) return;
      hasResult = Number.isInteger(result?.count) && result.count > 0;
      status.textContent = result ? copy.result(result.count || 0, result.missing || 0, result.boundary || 0) : copy.cancelled;
    } catch {
      if (!destroyed && current === generation) status.textContent = copy.failed;
    } finally {
      if (!destroyed && current === generation) { busy = false; syncButtons(); }
    }
  });
  const selectAll = button(copy.select, async () => {
    if (!hasResult || busy) return;
    const current = ++generation;
    busy = true;
    syncButtons();
    try {
      const result = await onSelectAll?.();
      if (!destroyed && current === generation) status.textContent = result === null ? copy.cancelled : copy.selected;
    } catch {
      if (!destroyed && current === generation) status.textContent = copy.failed;
    } finally {
      if (!destroyed && current === generation) { busy = false; syncButtons(); }
    }
  });
  button(copy.clear, () => clearFilter());
  const cancel = button(copy.cancel, () => { setPreviewEnabled(false); invalidate(); status.textContent = copy.cancelled; });
  function syncButtons() {
    apply.disabled = busy || !modelSelect.value;
    selectAll.disabled = busy || !hasResult;
    cancel.hidden = !busy;
    root.setAttribute("aria-busy", String(busy));
  }
  function invalidate() {
    generation += 1;
    if (busy) onCancel?.();
    busy = false;
    hasResult = false;
    status.textContent = copy.edited;
    syncButtons();
  }
  async function clearFilter() {
    setPreviewEnabled(false);
    invalidate();
    const current = ++generation;
    busy = true;
    syncButtons();
    status.textContent = copy.progress(0, 0);
    try {
      const result = await onClear?.();
      if (!destroyed && current === generation) {
        status.textContent = result === null ? copy.cancelled : modelSelect.value ? copy.cleared : copy.noModel;
      }
    } catch {
      if (!destroyed && current === generation) status.textContent = copy.failed;
    } finally {
      if (!destroyed && current === generation) { busy = false; syncButtons(); }
    }
  }
  function readSpec() {
    return resolveAxisRangeInput({
      modelId: modelSelect.value, mode: modeSelect.value,
      system: systems.find((system) => system.id === systemSelect.value),
      values: Object.fromEntries(Object.entries(values).map(([axis, entries]) => [axis, entries.map((entry) => ({
        value: entry.numeric.value, axisId: entry.anchor.value, offset: entry.offset.value,
      }))])),
    });
  }
  function publishPreview() {
    if (!destroyed) onPreview?.(previewToggle.checked ? readSpec() : null);
  }
  function setPreviewEnabled(enabled) {
    if (destroyed) return;
    const wasEnabled = previewToggle.checked;
    previewToggle.checked = Boolean(enabled && modelSelect.value);
    if (previewToggle.checked || wasEnabled) publishPreview();
  }
  function roundedBoundary(value, side) {
    return Number.isFinite(value) ? (side ? Math.ceil(value * 1000) : Math.floor(value * 1000)) / 1000 : null;
  }
  function syncSliders(axis) {
    const extent = [...(modelBounds?.[axis] || []), ...values[axis].map((entry) => finiteInput(entry.numeric.value))]
      .filter((value) => value != null && Number.isFinite(value));
    const min = extent.length ? roundedBoundary(Math.min(...extent), 0) : 0;
    const max = extent.length ? roundedBoundary(Math.max(...extent), 1) : 1;
    for (const entry of values[axis]) {
      entry.slider.min = String(min);
      entry.slider.max = String(max > min ? max : min + 0.001);
      entry.slider.disabled = !modelSelect.value;
      const value = finiteInput(entry.numeric.value);
      entry.slider.value = String(value ?? min);
    }
  }
  function resetNumericBounds() {
    modelBounds = getModelBounds(modelSelect.value);
    for (const axis of ["x", "y", "z"]) {
      values[axis].forEach((entry, side) => {
        const value = roundedBoundary(modelBounds?.[axis]?.[side], side);
        entry.numeric.value = value == null ? "" : String(value);
      });
      syncSliders(axis);
    }
    boundsNotice.textContent = `${copy.modelBounds}: ${["x", "y", "z"].map((axis) =>
      `${axis.toUpperCase()} ${[0, 1].map((side) => {
        const value = roundedBoundary(modelBounds?.[axis]?.[side], side);
        return value == null ? "\u2014" : value.toFixed(3);
      }).join(" \u2192 ")}`).join("; ")}`;
  }
  function configureSystem() {
    setPreviewEnabled(false);
    resetNumericBounds();
    const system = systems.find((item) => item.id === systemSelect.value);
    coordinateNotice.textContent = system ? copy.gridHint : copy.localHint;
    for (const axis of ["x", "y", "z"]) {
      legends[axis].textContent = system && axis !== "z" ? `${axis.toUpperCase()} (${axis === "x" ? "U" : "V"}) (m)` : `${axis.toUpperCase()} (m)`;
      for (const entry of values[axis]) {
        const gridMode = Boolean(system && axis !== "z");
        entry.slider.parentElement.hidden = gridMode;
        entry.slider.parentElement.style.display = gridMode ? "none" : "grid";
        entry.numeric.parentElement.hidden = gridMode;
        entry.numeric.parentElement.style.display = gridMode ? "none" : "grid";
        entry.anchor.parentElement.hidden = !gridMode;
        entry.anchor.parentElement.style.display = gridMode ? "grid" : "none";
        entry.offset.parentElement.hidden = !gridMode;
        entry.offset.parentElement.style.display = gridMode ? "grid" : "none";
        entry.anchor.replaceChildren();
        option(entry.anchor, "", copy.choose);
        for (const line of system?.[`${axis}Axes`] || []) option(entry.anchor, line.id, line.label);
        entry.anchor.value = "";
        entry.offset.value = "0";
      }
    }
    gridNotice.textContent = systems.length ? "" : copy.noGrid;
    gridNotice.hidden = systems.length > 0;
  }
  function configureModel() {
    systems = getGridOptions(modelSelect.value) || [];
    systemSelect.replaceChildren();
    option(systemSelect, "", copy.local);
    for (const system of systems) option(systemSelect, system.id, system.label);
    systemSelect.value = "";
    configureSystem();
    previewToggle.disabled = !modelSelect.value;
    syncButtons();
  }
  listen(modelSelect, "change", () => { const cleared = clearFilter(); configureModel(); return cleared; });
  listen(systemSelect, "change", () => { invalidate(); configureSystem(); });
  body.replaceChildren(root);
  function refresh() {
    if (destroyed) return;
    const models = getModels() || [];
    const nextSignature = JSON.stringify(models.map((model) => [model.modelId, model.displayName,
      getModelBounds(model.modelId), getGridOptions(model.modelId)]));
    if (signature === nextSignature) return;
    const previousModel = modelSelect.value;
    if (signature != null) void clearFilter();
    signature = nextSignature;
    modelSelect.replaceChildren();
    for (const model of models) option(modelSelect, model.modelId, model.displayName || model.modelId);
    modelSelect.value = models.some((model) => model.modelId === previousModel) ? previousModel : models[0]?.modelId || "";
    configureModel();
    if (!models.length) status.textContent = copy.noModel;
  }
  refresh();
  return {
    refresh,
    setPreviewEnabled,
    invalidateResult() {
      if (destroyed) return;
      setPreviewEnabled(false);
      invalidate();
      status.textContent = copy.cleared;
    },
    progress({ phase, processed = 0, total = 0 }) {
      if (!destroyed && busy && ["prepare", "classify", "apply", "select", "restore"].includes(phase)) status.textContent = copy.progress(processed, total);
    },
    destroy() {
      if (destroyed) return;
      setPreviewEnabled(false);
      generation += 1;
      if (busy) onCancel?.();
      destroyed = true;
      listeners.forEach((remove) => remove());
      root.remove();
    },
  };
}
