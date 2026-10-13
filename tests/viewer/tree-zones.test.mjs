import test from "node:test";
import assert from "node:assert/strict";
import { renderZoneTree } from "../../packages/viewer/src/xeokit/tree-zones.js";
import { resolveModelTreeCopy } from "../../packages/viewer/src/xeokit/tree-interaction.js";

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.events = {}; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attrs[name] = value; }
  addEventListener(name, callback) { this.events[name] = callback; }
  click() { this.events.click?.(); }
}
const all = (element) => [element, ...element.children.flatMap(all)];

test("zone controls disclose intersections, isolate complete groups, reset and clear removed model data", () => {
  const original = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    const body = new Element("div");
    const selections = [];
    let resets = 0;
    const floor = { type: "IfcBuildingStorey", id: "m#floor", name: "Tầng 2" };
    const viewer = { scene: { objects: { "m#wall": {}, "m#slab": {} } }, metaScene: { metaObjects: {
      "m#wall": { type: "IfcWall", parent: floor }, "m#slab": { type: "IfcSlab", parent: floor },
    } } };
    const options = { viewer, copy: resolveModelTreeCopy("vi"), onFocus: (ids) => selections.push(ids), onReset: () => { resets += 1; } };
    renderZoneTree(body, [{ modelId: "m", displayName: "Model", zoneGroups: [
      { id: "z", code: "Z1", name: "Zone 1", objectIds: ["wall", "slab"] },
    ] }], options);
    const buttons = all(body).filter((e) => e.tagName === "button");
    buttons.find((b) => b.attrs["aria-label"] === "Hiện riêng Z1 · Zone 1 — Model").click();
    buttons.find((b) => b.attrs["aria-label"] === "Hiện riêng Tầng 2").click();
    buttons.find((b) => b.attrs["aria-label"] === "Hiện riêng IfcWall").click();
    assert.deepEqual(selections, [["m#wall", "m#slab"], ["m#wall", "m#slab"], ["m#wall"]]);
    const toggle = buttons.find((b) => b.attrs["aria-expanded"] === "false");
    toggle.click();
    assert.equal(toggle.attrs["aria-expanded"], "true");
    buttons.find((b) => b.textContent === options.copy.clearZoneFilter).click();
    assert.equal(resets, 1);
    renderZoneTree(body, [], options);
    assert.equal(all(body).some((e) => e.tagName === "button"), false);
    assert.equal(body.children[0].textContent, options.copy.emptyZones);
    renderZoneTree(body, [{ modelId: "old" }], options);
    assert.equal(body.children[0].textContent, options.copy.zonesUnavailable);
  } finally { globalThis.document = original; }
});
