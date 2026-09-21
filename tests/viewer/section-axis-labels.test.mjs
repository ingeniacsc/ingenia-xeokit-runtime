import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createSectionAxisLabels } from "../../packages/viewer/src/xeokit/section-axis-labels.js";

const labelsUrl = new URL("../../packages/viewer/src/xeokit/section-axis-labels.js", import.meta.url);

test("section gizmo labels retain IFC axis semantics in the Xeokit Y-up runtime", async () => {
  const source = await readFile(labelsUrl, "utf8");

  assert.match(source, /x:\s*\[1, 0, 0\]/);
  assert.match(source, /y:\s*\[0, 0, -1\]/);
  assert.match(source, /z:\s*\[0, 1, 0\]/);
  assert.match(source, /viewer\.camera\.projectWorldPos/);
  assert.match(source, /ArrayBuffer\.isView\(point\)/);
  assert.match(source, /requestAnimationFrame/);
});

test("section gizmo labels render coordinates returned as typed arrays", () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const originalWindow = globalThis.window;
  const labels = Object.fromEntries(["x", "y", "z"].map((axis) => [axis, {
    hidden: true,
    style: {},
  }]));
  const projectedPositions = [];
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.window = {
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };

  try {
    const controller = createSectionAxisLabels({
      viewer: {
        scene: { getAABB: () => [0, 0, 0, 10, 10, 10] },
        camera: { projectWorldPos: (point) => {
          projectedPositions.push(point);
          return new Float32Array([120, 240]);
        } },
      },
      container: {
        hidden: true,
        querySelector: (selector) => labels[selector.match(/"([xyz])"/)?.[1]] || null,
      },
    });

    controller.setSectionPlane({ pos: [5, 5, 5] });

    // A one-metre IFC basis rotated -90 degrees about X is [X, Z, -Y].
    // This matches the shared-coordinate grid mapping, not a mirrored Y axis.
    assert.deepEqual(projectedPositions, [[6, 5, 5], [5, 5, 4], [5, 6, 5]]);

    for (const label of Object.values(labels)) {
      assert.equal(label.hidden, false);
      assert.equal(label.style.left, "120px");
      assert.equal(label.style.top, "240px");
    }
    controller.destroy();
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    globalThis.window = originalWindow;
  }
});
