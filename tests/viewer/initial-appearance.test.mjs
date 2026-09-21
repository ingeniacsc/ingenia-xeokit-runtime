import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const runtimeUrl = new URL("../../packages/viewer/src/xeokit/runtime.js", import.meta.url);
const appearanceUrl = new URL("../../packages/viewer/src/xeokit/appearance.js", import.meta.url);
const stylesUrl = new URL("../../packages/viewer/src/styles.css", import.meta.url);

test("viewer keeps model appearance while rendering a broad day and night horizon", async () => {
  const [runtime, appearance, styles] = await Promise.all([
    readFile(runtimeUrl, "utf8"),
    readFile(appearanceUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);

  assert.match(runtime, /backgroundColor: \[0\.957, 0\.937, 0\.902\]/);
  assert.match(appearance, /: \[0\.957, 0\.937, 0\.902\]/);
  assert.match(styles, /background: #f4efe6/);
  assert.match(runtime, /transparent: true/);
  assert.match(styles, /linear-gradient\(180deg, #abc6d3 0%, #cfdee3 35%, #e8eeed 55%, #f2f5f1 68%, #e0e7e1 100%\)/);
  assert.match(styles, /linear-gradient\(180deg, #142029 0%, #293d49 35%, #435b66 55%, #526b73 68%, #2d414a 100%\)/);
});
