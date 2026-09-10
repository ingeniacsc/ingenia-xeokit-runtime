import test from "node:test";
import assert from "node:assert/strict";
import {
  bindModelTreeKeyboardNavigation,
  resolveModelTreeCopy,
  resolveSingleModelTreeSelection,
} from "../../packages/viewer/src/xeokit/tree-interaction.js";

test("tree selections fail closed when a node spans federation models", () => {
  assert.deepEqual(resolveSingleModelTreeSelection(["model-a#wall-1", "model-a#wall-2"]), {
    identifiers: ["model-a#wall-1", "model-a#wall-2"],
    modelVersionId: "model-a",
  });
  assert.equal(resolveSingleModelTreeSelection(["model-a#wall-1", "model-b#wall-2"]), null);
  assert.equal(resolveSingleModelTreeSelection([]), null);
});

test("tree copy is localized without exposing business vocabulary", () => {
  assert.equal(resolveModelTreeCopy("vi").tabs.storeys, "Tầng");
  assert.equal(resolveModelTreeCopy("en").tabs.storeys, "Storeys");
  assert.equal(resolveModelTreeCopy("fr").panel, "Cây thư mục mô hình");
});

test("tree keyboard navigation activates titles and wraps tabs", () => {
  const bodyListeners = new Map();
  const tabListeners = new Map();
  let titleClicks = 0;
  const title = { click() { titleClicks += 1; }, matches: (selector) => selector === "li > span" };
  const buttons = [0, 1, 2].map((index) => ({
    clicked: false, focused: false,
    click() { this.clicked = true; }, focus() { this.focused = true; }, index,
  }));
  const bodies = {
    addEventListener: (type, listener) => bodyListeners.set(type, listener),
    removeEventListener: (type) => bodyListeners.delete(type),
  };
  const tabs = {
    addEventListener: (type, listener) => tabListeners.set(type, listener),
    removeEventListener: (type) => tabListeners.delete(type),
    querySelectorAll: () => buttons,
  };
  const unbind = bindModelTreeKeyboardNavigation({ bodies, tabs });
  let prevented = false;
  bodyListeners.get("keydown")({ target: title, key: "Enter", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(titleClicks, 1);
  tabListeners.get("keydown")({ target: buttons[0], key: "ArrowLeft", preventDefault() {} });
  assert.equal(buttons[2].focused, true);
  assert.equal(buttons[2].clicked, true);
  unbind();
  assert.equal(bodyListeners.size, 0);
  assert.equal(tabListeners.size, 0);
});
