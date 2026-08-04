import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const entry = require.resolve("@loaders.gl/polyfills");
let packageRoot = path.dirname(entry);

while (packageRoot !== path.dirname(packageRoot)) {
  try {
    const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
    if (manifest.name === "@loaders.gl/polyfills" && manifest.version === "4.3.4") break;
  } catch {
    // Continue toward the package root.
  }
  packageRoot = path.dirname(packageRoot);
}

const replacements = new Map([
  ["dist/index.js", [["./buffer/btoa.node", "./buffer/btoa.node.js"], ["./load-library/require-utils.node", "./load-library/require-utils.node.js"]]],
  ["dist/file/file-reader.js", [["../buffer/btoa.node", "../buffer/btoa.node.js"]]],
  ["dist/filesystems/fetch-node.js", [["./stream-utils.node", "./stream-utils.node.js"]]],
  ["dist/fetch/response-polyfill.js", [["../filesystems/stream-utils.node", "../filesystems/stream-utils.node.js"]]],
  ["dist/images/encode-image-node.js", [["../buffer/to-array-buffer.node", "../buffer/to-array-buffer.node.js"]]],
]);

for (const [relativePath, pairs] of replacements) {
  const target = path.join(packageRoot, relativePath);
  const original = await readFile(target, "utf8");
  let updated = original.replaceAll(".node.js.js", ".node.js");
  for (const [from, to] of pairs) {
    if (!updated.includes(from) && !updated.includes(to)) {
      throw new Error(`Expected import not found in ${relativePath}: ${from}`);
    }
    updated = updated.replaceAll(`'${from}'`, `'${to}'`).replaceAll(`"${from}"`, `"${to}"`);
  }
  updated = updated.replaceAll(".node.js.js", ".node.js");
  if (updated !== original) await writeFile(target, updated, "utf8");
}

console.log("Reviewed @loaders.gl/polyfills 4.3.4 compatibility patch is applied.");
