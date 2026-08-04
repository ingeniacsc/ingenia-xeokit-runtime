import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const minimumSmokeBytes = 512;
const expectedXktVersion = 12;

export async function verifyXktSmokeOutput(outputPath) {
  if (!outputPath) throw new Error("An XKT output path is required");
  const output = await readFile(outputPath);
  if (output.byteLength < minimumSmokeBytes) {
    throw new Error(`XKT smoke output is too small: ${output.byteLength} bytes`);
  }
  const version = output.readUInt32LE(0);
  if (version !== expectedXktVersion) {
    throw new Error(`Expected XKT version ${expectedXktVersion}, received ${version}`);
  }
  if (!output.subarray(4).some((value) => value !== 0)) {
    throw new Error("XKT smoke output has no non-zero payload");
  }
  return { bytes: output.byteLength, version };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyXktSmokeOutput(process.argv[2])
    .then((result) => console.log(JSON.stringify({ status: "ok", ...result })))
    .catch((error) => {
      console.error(`XKT smoke verification failed: ${error.message}`);
      process.exitCode = 1;
    });
}
