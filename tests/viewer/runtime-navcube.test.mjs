import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const runtimeUrl = new URL("../../packages/viewer/src/xeokit/runtime.js", import.meta.url);
const indexUrl = new URL("../../packages/viewer/index.html", import.meta.url);

test("isolated Viewer renders the Xeokit navigation cube on its own helper canvas", async () => {
  const [runtimeSource, indexSource] = await Promise.all([
    readFile(runtimeUrl, "utf8"),
    readFile(indexUrl, "utf8"),
  ]);

  assert.match(indexSource, /id="xeokit-navcube"/);
  assert.match(indexSource, /id="navcube-canvas"/);
  assert.match(runtimeSource, /NavCubePlugin/);
  assert.match(runtimeSource, /canvasElement: navCubeCanvas/);
  assert.match(runtimeSource, /cameraFly: true/);
  assert.match(runtimeSource, /navCube\?\.destroy\?\.\(\)/);
});
