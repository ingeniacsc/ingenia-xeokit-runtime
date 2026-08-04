import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyXktSmokeOutput } from "./verify-xkt-smoke-output.mjs";

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(runtimeRoot, "tests", "fixtures", "ingenia-smoke-wall.ifc");
const wrapper = path.join(
  runtimeRoot,
  "packages",
  "converter",
  "bin",
  "ingenia-xeokit-convert.mjs",
);

function runConverter(outputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      wrapper,
      "--source", fixture,
      "--format", "ifc",
      "--output", outputPath,
    ], {
      cwd: runtimeRoot,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Converter smoke terminated by ${signal}`));
      else if (code !== 0) reject(new Error(`Converter smoke exited with code ${code}`));
      else resolve();
    });
  });
}

export async function verifyConverterSmoke() {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "ingenia-xeokit-smoke-"));
  const outputPath = path.join(temporaryDirectory, "ingenia-smoke-wall.xkt");
  try {
    await runConverter(outputPath);
    return await verifyXktSmokeOutput(outputPath);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyConverterSmoke()
    .then((result) => console.log(JSON.stringify({ status: "ok", ...result })))
    .catch((error) => {
      console.error(`Converter smoke failed: ${error.message}`);
      process.exitCode = 1;
    });
}
