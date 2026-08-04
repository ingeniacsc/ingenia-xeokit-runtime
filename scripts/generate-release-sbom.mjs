import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedSourcePrefix = "https://github.com/ingeniacsc/ingenia-xeokit-runtime/tree/";

export function validateReleaseMetadata(environment = process.env) {
  const epoch = environment.SOURCE_DATE_EPOCH ?? "";
  const version = environment.RELEASE_VERSION ?? "";
  const revision = environment.RELEASE_REVISION ?? "";
  const sourceUrl = environment.RELEASE_SOURCE_URL ?? "";

  if (!/^\d+$/.test(epoch)) {
    throw new Error("SOURCE_DATE_EPOCH must be a non-negative integer");
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("RELEASE_VERSION must be an explicit semantic version");
  }
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error("RELEASE_REVISION must be exactly 40 lowercase hexadecimal characters");
  }
  if (sourceUrl !== `${expectedSourcePrefix}${revision}`) {
    throw new Error("RELEASE_SOURCE_URL must identify the exact RELEASE_REVISION");
  }
  if (revision === "0".repeat(40) && environment.ALLOW_CANDIDATE_REVISION !== "true") {
    throw new Error("All-zero revision is candidate evidence only");
  }

  const created = new Date(Number(epoch) * 1_000);
  if (Number.isNaN(created.getTime())) {
    throw new Error("SOURCE_DATE_EPOCH is outside the supported date range");
  }
  return { created: created.toISOString(), version, revision, sourceUrl };
}

export function normalizeSpdxDocument(document, metadata) {
  if (!document || document.spdxVersion !== "SPDX-2.3") {
    throw new Error("npm did not return an SPDX 2.3 document");
  }

  const normalized = structuredClone(document);
  normalized.name = `ingenia-xeokit-runtime-${metadata.version}`;
  normalized.documentNamespace =
    `https://github.com/ingeniacsc/ingenia-xeokit-runtime/sbom/` +
    `${metadata.revision}/${metadata.version}`;
  normalized.creationInfo = {
    ...(normalized.creationInfo ?? {}),
    created: metadata.created,
    comment: `Corresponding Source: ${metadata.sourceUrl}`,
  };
  normalized.comment = [
    `Release version: ${metadata.version}`,
    `Release revision: ${metadata.revision}`,
    `Corresponding Source: ${metadata.sourceUrl}`,
    metadata.revision === "0".repeat(40)
      ? "Candidate evidence only; all-zero revision is not releasable."
      : "Release metadata is bound to the named public source commit.",
  ].join("\n");

  const rootPackage = normalized.packages?.find(
    (entry) => entry.name === "ingenia-xeokit-runtime",
  );
  if (!rootPackage) {
    throw new Error("SPDX output does not describe the runtime root package");
  }
  rootPackage.versionInfo = metadata.version;
  rootPackage.downloadLocation = metadata.sourceUrl;

  const converterPackage = normalized.packages?.find(
    (entry) => entry.name === "@xeokit/xeokit-convert",
  );
  if (!converterPackage || converterPackage.versionInfo !== "1.3.2") {
    throw new Error("SPDX output must contain @xeokit/xeokit-convert 1.3.2");
  }
  return normalized;
}

export function generateRawSpdx() {
  const npmCli = process.env.npm_execpath || path.resolve(
    path.dirname(process.execPath),
    "node_modules/npm/bin/npm-cli.js",
  );
  return JSON.parse(execFileSync(
    process.execPath,
    [npmCli, "sbom", "--sbom-format", "spdx", "--omit", "dev"],
    { cwd: runtimeRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  ));
}

export async function generateReleaseSbom(environment = process.env) {
  const metadata = validateReleaseMetadata(environment);
  const normalized = normalizeSpdxDocument(generateRawSpdx(), metadata);
  const destination = path.resolve(runtimeRoot, "sbom.spdx.json");
  if (path.dirname(destination) !== runtimeRoot) {
    throw new Error("Refusing to write SBOM outside the public runtime root");
  }
  await writeFile(destination, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return destination;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateReleaseSbom()
    .then((destination) => console.log(`SPDX SBOM written to ${destination}`))
    .catch((error) => {
      console.error(`SBOM generation failed: ${error.message}`);
      process.exitCode = 1;
    });
}
