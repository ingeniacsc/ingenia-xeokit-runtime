import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const runtimeUrl = new URL("../../packages/viewer/src/xeokit/runtime.js", import.meta.url);
const appearanceUrl = new URL("../../packages/viewer/src/xeokit/appearance.js", import.meta.url);
const stylesUrl = new URL("../../packages/viewer/src/styles.css", import.meta.url);

test("viewer boots with the same day surface used by the legacy viewer", async () => {
  const [runtime, appearance, styles] = await Promise.all([
    readFile(runtimeUrl, "utf8"),
    readFile(appearanceUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);

  assert.match(runtime, /backgroundColor: \[0\.957, 0\.937, 0\.902\]/);
  assert.match(appearance, /: \[0\.957, 0\.937, 0\.902\]/);
  assert.match(styles, /background: #f4efe6/);
});
