import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedSourcePrefix = "https://github.com/ingeniacsc/ingenia-xeokit-runtime/tree/";
const scopes = {
  source: { output: "sbom.spdx.json", workspaces: [] },
  viewer: { output: "sbom.viewer.spdx.json", workspaces: ["@ingenia/xeokit-viewer", "@ingenia/generic-bim-viewport-protocol"] },
  converter: { output: "sbom.converter.spdx.json", workspaces: ["@ingenia/xeokit-converter"] },
};

export function resolveSbomScope(scope = "source") {
  if (!Object.hasOwn(scopes, scope)) throw new Error("SBOM_SCOPE must be source, viewer or converter");
  return scopes[scope];
}

export function sbomArguments(scope = "source") {
  const { workspaces } = resolveSbomScope(scope);
  return ["sbom", "--package-lock-only", "--offline", "--sbom-format", "spdx", "--omit", "dev",
    ...workspaces.flatMap((workspace) => ["--workspace", workspace]),
    ...(workspaces.length ? ["--include-workspace-root=false"] : [])];
}

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

export function normalizeSpdxDocument(document, metadata, scope = "source") {
  resolveSbomScope(scope);
  if (!document || document.spdxVersion !== "SPDX-2.3") {
    throw new Error("npm did not return an SPDX 2.3 document");
  }

  const normalized = structuredClone(document);
  normalized.name = `ingenia-xeokit-${scope}-${metadata.version}`;
  normalized.documentNamespace =
    `https://github.com/ingeniacsc/ingenia-xeokit-runtime/sbom/` +
    `${metadata.revision}/${metadata.version}/${scope}`;
  normalized.creationInfo = {
    ...(normalized.creationInfo ?? {}),
    created: metadata.created,
    comment: `Corresponding Source: ${metadata.sourceUrl}`,
  };
  normalized.comment = [
    `Dependency scope: ${scope}; lock-derived npm production workspace graph, not an OS image inventory.`,
    `Release version: ${metadata.version}`,
    `Release revision: ${metadata.revision}`,
    `Corresponding Source: ${metadata.sourceUrl}`,
    metadata.revision === "0".repeat(40)
      ? "Candidate evidence only; all-zero revision is not releasable."
      : "Release metadata is bound to the named public source commit.",
  ].join("\n");

  const rootNames = ["ingenia-xeokit-runtime", ...resolveSbomScope(scope).workspaces];
  const rootPackage = normalized.packages?.find(
    (entry) => rootNames.includes(entry.name),
  );
  if (!rootPackage) {
    throw new Error("SPDX output does not describe the runtime root package");
  }
  rootPackage.versionInfo = metadata.version;
  rootPackage.downloadLocation = metadata.sourceUrl;

  const converterPackage = normalized.packages?.find(
    (entry) => entry.name === "@xeokit/xeokit-convert",
  );
  if (scope !== "viewer" && (!converterPackage || converterPackage.versionInfo !== "1.3.2")) {
    throw new Error("SPDX output must contain @xeokit/xeokit-convert 1.3.2");
  }
  if (scope === "viewer") {
    const sdk = normalized.packages?.find((entry) => entry.name === "@xeokit/xeokit-sdk");
    if (sdk?.versionInfo !== "2.6.107") throw new Error("Viewer SPDX must contain @xeokit/xeokit-sdk 2.6.107");
    if (converterPackage || normalized.packages?.some((entry) => entry.name === "@ingenia/xeokit-converter")) {
      throw new Error("Viewer SPDX must exclude the converter");
    }
    const forbidden = new Set(["@loaders.gl/polyfills", "get-pixels", "request", "web-ifc", "vite", "texture-compressor", "image-size"]);
    if (normalized.packages?.some((entry) => forbidden.has(entry.name))) {
      throw new Error("Viewer SPDX contains converter-only or build tooling dependencies");
    }
  }
  if (scope === "converter" && normalized.packages?.some((entry) => entry.name === "@ingenia/xeokit-viewer" || entry.name === "vite")) {
    throw new Error("Converter SPDX must exclude the Viewer workspace and build tooling");
  }
  return normalized;
}

export function generateRawSpdx(scope = "source") {
  const npmCli = process.env.npm_execpath || path.resolve(
    path.dirname(process.execPath),
    "node_modules/npm/bin/npm-cli.js",
  );
  return JSON.parse(execFileSync(
    process.execPath,
    [npmCli, ...sbomArguments(scope)],
    { cwd: runtimeRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  ));
}

export async function generateReleaseSbom(environment = process.env) {
  const metadata = validateReleaseMetadata(environment);
  const scope = environment.SBOM_SCOPE ?? "source";
  const { output } = resolveSbomScope(scope);
  const normalized = normalizeSpdxDocument(generateRawSpdx(scope), metadata, scope);
  const destination = path.resolve(runtimeRoot, output);
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
