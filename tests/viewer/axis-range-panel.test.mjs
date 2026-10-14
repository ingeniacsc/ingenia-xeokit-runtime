import test from "node:test";
import assert from "node:assert/strict";
import { createAxisRangePanel, resolveAxisRangeInput } from "../../packages/viewer/src/xeokit/axis-range-panel.js";

const numericValues = () => ({ x: [{ value: "0" }, { value: "10" }], y: [{ value: "-2" }, { value: "12" }], z: [{ value: "1" }, { value: "8" }] });
const grid = {
  id: "g", label: "Verified grid", frame: { origin: [100, 200], x: [0, 1], y: [-1, 0] },
  xAxes: [{ id: "a", label: "A", value: 10 }, { id: "b", label: "B", value: 20 }],
  yAxes: [{ id: "1", label: "1", value: -5 }, { id: "2", label: "2", value: 10 }],
};

test("all six bounds must be explicit finite increasing ranges; no invalid Z is ignored", () => {
  const valid = { modelId: "m", values: numericValues(), mode: "contained" };
  assert.deepEqual(resolveAxisRangeInput(valid), {
    modelId: "m", mode: "contained", bounds: { x: [0, 10], y: [-2, 12], z: [1, 8] },
  });
  for (const bad of ["", " ", "NaN", "Infinity", "1", "-8"]) {
    const values = numericValues();
    values.z[1].value = bad;
    assert.equal(resolveAxisRangeInput({ ...valid, values }), null, bad);
  }
  assert.equal(resolveAxisRangeInput({ ...valid, modelId: "" }), null);
  assert.equal(resolveAxisRangeInput({ ...valid, mode: "unsupported" }), null);
});

test("named grid offsets resolve against grid frame, never model XYZ bounds", () => {
  const values = numericValues();
  values.x = [{ axisId: "a", offset: "-1", value: "999" }, { axisId: "b", offset: "2" }];
  values.y = [{ axisId: "1", offset: "0" }, { axisId: "2", offset: "-.5" }];
  const input = { modelId: "m", values, mode: "intersects", system: grid };
  assert.deepEqual(resolveAxisRangeInput(input), {
    modelId: "m", bounds: { x: [9, 22], y: [-5, 9.5], z: [1, 8] }, mode: "intersects", frame: grid.frame,
  });
  values.x[0].axisId = "unverified-axis";
  assert.equal(resolveAxisRangeInput(input), null);
  values.x[0].axisId = "a";
  values.y[1].offset = "";
  assert.equal(resolveAxisRangeInput(input), null);
});

// Small DOM harness: exercise event behavior and async lifecycle, not stylesheet implementation.
class Element {
  constructor(tag, doc) { this.tagName = tag; this.ownerDocument = doc; this.children = []; this.events = new Map(); this.attrs = {}; this.style = {}; this.value = ""; }
  append(...children) { children.forEach((child) => { child.parentElement = this; this.children.push(child); }); }
  replaceChildren(...children) { this.children.forEach((child) => { child.parentElement = null; }); this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(name, fn) { this.events.set(name, [...(this.events.get(name) || []), fn]); }
  removeEventListener(name, fn) { this.events.set(name, (this.events.get(name) || []).filter((handler) => handler !== fn)); }
  async emit(name) { for (const handler of this.events.get(name) || []) await handler({ target: this }); }
  remove() { this.parentElement.children = this.parentElement.children.filter((child) => child !== this); this.parentElement = null; }
}
function harness(callbacks = {}) {
  const doc = { createElement: (tag) => new Element(tag, doc) };
  const body = new Element("body", doc);
  const models = [{ modelId: "m", displayName: "Version 2" }];
  const events = [];
  const panel = createAxisRangePanel(body, {
    locale: "en", getModels: () => models, getModelBounds: () => ({ x: [0, 10], y: [0, 10], z: [0, 10] }),
    onApply: async (payload) => { events.push(["apply", payload]); return { count: 12, missing: 1, boundary: 2 }; },
    onSelectAll: async () => events.push(["select"]), onClear: () => events.push(["clear"]), onCancel: () => events.push(["cancel"]),
    ...callbacks,
  });
  const walk = (node) => [node, ...node.children.flatMap(walk)];
  const byText = (text) => walk(body).find((node) => node.textContent === text);
  const byLabel = (label) => walk(body).find((node) => node.attrs["aria-label"] === label);
  const status = () => walk(body).find((node) => node.attrs.role === "status").textContent;
  return { panel, body, models, events, byText, byLabel, status };
}

test("apply shows region without selecting; select all is explicit and editing invalidates result", async () => {
  const h = harness();
  const apply = h.byText("Show only region");
  const select = h.byText("Select all in region");
  assert.equal(select.disabled, true);
  await apply.emit("click");
  assert.deepEqual(h.events.map(([event]) => event), ["apply"]);
  assert.equal(select.disabled, false);
  assert.match(h.status(), /12 elements.*2 cross.*1 have/);
  await select.emit("click");
  assert.deepEqual(h.events.map(([event]) => event), ["apply", "select"]);
  h.byLabel("Z To").value = "7";
  await h.byLabel("Z To").emit("input");
  assert.equal(select.disabled, true);
  h.panel.refresh();
  assert.equal(h.byLabel("Z To").value, "7", "unchanged refresh preserves user input");
  h.panel.destroy();
  assert.equal(h.body.children.length, 0);
});

test("cancelled or edited in-flight apply cannot enable a stale selection", async () => {
  let resolveApply;
  const h = harness({ onApply: () => new Promise((resolve) => { resolveApply = resolve; }) });
  const pending = h.byText("Show only region").emit("click");
  assert.equal(h.byText("Show only region").disabled, true);
  h.byLabel("X From").value = "2";
  await h.byLabel("X From").emit("input");
  resolveApply({ count: 42 });
  await pending;
  assert.equal(h.byText("Select all in region").disabled, true);
  assert.deepEqual(h.events, [["cancel"]]);
  assert.match(h.status(), /Range changed/);
  h.panel.destroy();
});

test("grid requires explicit axes and model removal clears the old result", async () => {
  const h = harness({ getGridOptions: () => [grid] });
  await h.byText("Show only region").emit("click");
  h.byLabel("Coordinate system").value = "g";
  await h.byLabel("Coordinate system").emit("change");
  await h.byText("Show only region").emit("click");
  assert.match(h.status(), /requires all four boundary axes/);
  assert.equal(h.events.filter(([event]) => event === "apply").length, 1);
  assert.equal(h.byLabel("X From").parentElement.hidden, true);
  assert.equal(h.byLabel("X From").parentElement.style.display, "none");
  assert.equal(h.byLabel("X From · Grid axis").parentElement.style.display, "grid");
  assert.equal(h.byLabel("Z From").parentElement.hidden, false);
  assert.equal(h.byLabel("Z From").parentElement.style.display, "grid");
  assert.equal(h.byLabel("Z From · Grid axis").parentElement.style.display, "none");
  h.models.length = 0;
  h.panel.refresh();
  assert.equal(h.byText("Select all in region").disabled, true);
  assert.equal(h.byText("Show only region").disabled, true);
  assert.ok(h.events.some(([event]) => event === "clear"));
  h.panel.destroy();
});

test("null select result reports cancellation and clear waits for restore before success", async () => {
  let finishClear;
  const h = harness({ onSelectAll: async () => null, onClear: () => new Promise((resolve) => { finishClear = resolve; }) });
  await h.byText("Show only region").emit("click");
  await h.byText("Select all in region").emit("click");
  assert.equal(h.status(), "Processing cancelled.");
  const clearing = h.byText("Clear filter").emit("click");
  assert.equal(h.byText("Show only region").disabled, true);
  assert.notEqual(h.status(), "Region filter cleared.");
  h.panel.progress({ phase: "restore", processed: 10, total: 30 });
  assert.equal(h.status(), "Processing 10/30 elements…");
  finishClear(true);
  await clearing;
  assert.equal(h.status(), "Region filter cleared.");
  assert.equal(h.byText("Show only region").disabled, false);
  h.panel.destroy();
});

test("clear rejection is handled and cancelled restore cannot overwrite a newer edit", async () => {
  let rejectClear;
  const h = harness({ onClear: () => new Promise((resolve, reject) => { rejectClear = reject; }) });
  let clearing = h.byText("Clear filter").emit("click");
  rejectClear(new Error("restore unavailable"));
  await clearing;
  assert.match(h.status(), /Unable to filter/);
  assert.equal(h.byText("Show only region").disabled, false);
  clearing = h.byText("Clear filter").emit("click");
  await h.byLabel("Z To").emit("input");
  rejectClear(new Error("stale rejection"));
  await clearing;
  assert.match(h.status(), /Range changed/);
  h.panel.destroy();
});

test("classification progress is displayed while the apply operation is running", async () => {
  let finishApply;
  const h = harness({ onApply: () => new Promise((resolve) => { finishApply = resolve; }) });
  const applying = h.byText("Show only region").emit("click");
  h.panel.progress({ phase: "classify", processed: 128, total: 500 });
  assert.equal(h.status(), "Processing 128/500 elements…");
  finishApply({ count: 9 });
  await applying;
  h.panel.destroy();
});

test("external invalidation disables a result even when the model and grid signature is unchanged", async () => {
  const h = harness();
  await h.byText("Show only region").emit("click");
  assert.equal(h.byText("Select all in region").disabled, false);
  h.panel.invalidateResult();
  h.panel.refresh();
  assert.equal(h.byText("Select all in region").disabled, true);
  assert.equal(h.status(), "Region filter cleared.");
  assert.equal(h.byLabel("Z To").value, "10");
  h.panel.destroy();
  h.panel.invalidateResult();
});


test("preview is opt-in, sliders and numbers sync without filtering or selecting", async () => {
  const previews = [];
  const h = harness({ onPreview: (spec) => previews.push(spec) });
  const toggle = h.byLabel("Preview XYZ section planes");
  assert.equal(toggle.checked, false);
  assert.deepEqual(previews, []);
  const numeric = h.byLabel("X From");
  const slider = h.byLabel("X From \u00b7 Slider");
  numeric.value = "-20.123";
  await numeric.emit("input");
  assert.equal(slider.min, "-20.123");
  assert.equal(slider.value, "-20.123");
  assert.equal(slider.step, "0.001");
  assert.deepEqual(previews, []);
  toggle.checked = true;
  await toggle.emit("change");
  assert.deepEqual(previews.at(-1).bounds.x, [-20.123, 10]);
  slider.value = "2.125";
  await slider.emit("input");
  assert.equal(numeric.value, "2.125");
  assert.deepEqual(previews.at(-1).bounds.x, [2.125, 10]);
  assert.deepEqual(h.events, [], "preview must never apply an element filter or selection");
  assert.equal(h.byText("Select all in region").disabled, true);
  h.panel.destroy();
  assert.equal(previews.at(-1), null);
});

test("invalid live bounds clear the preview rather than retaining stale clipping", async () => {
  const previews = [];
  const h = harness({ onPreview: (spec) => previews.push(spec) });
  h.panel.setPreviewEnabled(true);
  for (const value of ["", "10", "15", "Infinity"]) {
    h.byLabel("Z From").value = value;
    await h.byLabel("Z From").emit("input");
    assert.equal(previews.at(-1), null, value);
  }
  h.byLabel("Z From").value = "3";
  await h.byLabel("Z From").emit("input");
  assert.deepEqual(previews.at(-1).bounds.z, [3, 10]);
  h.panel.setPreviewEnabled(false);
  assert.equal(previews.at(-1), null);
  assert.equal(h.byLabel("Preview XYZ section planes").checked, false);
  const count = previews.length;
  h.panel.setPreviewEnabled(false);
  h.panel.destroy();
  assert.equal(previews.length, count, "idempotent teardown does not repeatedly rebuild the scene");
});

test("outward millimetre defaults keep the whole initial model inside and show concise extents", () => {
  const bounds = { x: [-47.695219, 12.163399], y: [-39.360049, 32.121481], z: [0.00001, 50.00001] };
  const previews = [];
  const h = harness({ getModelBounds: () => bounds, onPreview: (spec) => previews.push(spec) });
  assert.equal(h.byLabel("X From").value, "-47.696");
  assert.equal(h.byLabel("X To").value, "12.164");
  assert.equal(h.byLabel("Z From").value, "0");
  assert.equal(h.byLabel("Z To").value, "50.001");
  assert.ok(h.byText("Model bounds (m): X -47.696 \u2192 12.164; Y -39.361 \u2192 32.122; Z 0.000 \u2192 50.001"));
  h.panel.setPreviewEnabled(true);
  for (const axis of ["x", "y", "z"]) {
    assert.ok(previews.at(-1).bounds[axis][0] <= bounds[axis][0]);
    assert.ok(previews.at(-1).bounds[axis][1] >= bounds[axis][1]);
  }
  h.panel.destroy();
});

test("verified grid preview keeps its rotated frame and only Z uses model sliders", async () => {
  const previews = [];
  const h = harness({ getGridOptions: () => [grid], onPreview: (spec) => previews.push(spec) });
  h.panel.setPreviewEnabled(true);
  h.byLabel("Coordinate system").value = "g";
  await h.byLabel("Coordinate system").emit("change");
  assert.equal(previews.at(-1), null);
  assert.equal(h.byLabel("Preview XYZ section planes").checked, false);
  assert.equal(h.byLabel("X From \u00b7 Slider").parentElement.hidden, true);
  assert.equal(h.byLabel("Y To \u00b7 Slider").parentElement.style.display, "none");
  assert.equal(h.byLabel("Z From \u00b7 Slider").parentElement.hidden, false);
  h.panel.setPreviewEnabled(true);
  assert.equal(previews.at(-1), null, "all four grid boundaries must be explicit");
  for (const [label, value] of [["X From", "a"], ["X To", "b"], ["Y From", "1"], ["Y To", "2"]]) {
    h.byLabel(`${label} \u00b7 Grid axis`).value = value;
    await h.byLabel(`${label} \u00b7 Grid axis`).emit("change");
  }
  assert.deepEqual(previews.at(-1).frame, grid.frame);
  assert.deepEqual(previews.at(-1).bounds, { x: [10, 20], y: [-5, 10], z: [0, 10] });
  h.byLabel("Z To \u00b7 Slider").value = "7.5";
  await h.byLabel("Z To \u00b7 Slider").emit("input");
  assert.deepEqual(previews.at(-1).bounds.z, [0, 7.5]);
  h.byLabel("Coordinate system").value = "";
  await h.byLabel("Coordinate system").emit("change");
  assert.equal(previews.at(-1), null);
  assert.equal(h.byLabel("X From").value, "0");
  assert.equal(h.byLabel("X To").value, "10", "switching to local does not reuse grid coordinates");
  assert.equal(h.byLabel("X From \u00b7 Slider").parentElement.hidden, false);
  h.panel.destroy();
});

test("apply, clear, cancel, model and external lifecycle invalidation disable preview", async () => {
  const previews = [];
  const h = harness({ onPreview: (spec) => previews.push(spec),
    getModelBounds: (id) => ({ x: id === "other" ? [20, 30] : [0, 10], y: [0, 10], z: [0, 10] }) });
  for (const action of ["Show only region", "Clear filter", "Cancel processing"]) {
    h.panel.setPreviewEnabled(true);
    await h.byText(action).emit("click");
    assert.equal(h.byLabel("Preview XYZ section planes").checked, false, action);
    assert.equal(previews.at(-1), null, action);
  }
  h.panel.setPreviewEnabled(true);
  h.panel.invalidateResult();
  assert.equal(previews.at(-1), null);
  h.panel.setPreviewEnabled(true);
  h.models.push({ modelId: "other", displayName: "Other model" });
  h.panel.refresh();
  assert.equal(previews.at(-1), null);
  h.panel.setPreviewEnabled(true);
  h.byLabel("Model").value = "other";
  await h.byLabel("Model").emit("change");
  assert.equal(previews.at(-1), null);
  assert.equal(h.byLabel("X From").value, "20");
  assert.equal(h.byLabel("X To \u00b7 Slider").max, "30");
  h.panel.destroy();
});
