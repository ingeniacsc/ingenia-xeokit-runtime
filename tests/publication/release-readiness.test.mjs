import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeSpdxDocument,
  generateRawSpdx,
  resolveSbomScope,
  sbomArguments,
  validateReleaseMetadata,
} from "../../scripts/generate-release-sbom.mjs";
import { scanPublicTree, scanText } from "../../scripts/validate-publication.mjs";

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const zeroRevision = "0".repeat(40);
const candidateEnvironment = {
  SOURCE_DATE_EPOCH: "1785715200",
  RELEASE_VERSION: "0.2.0-dev",
  RELEASE_REVISION: zeroRevision,
  RELEASE_SOURCE_URL:
    `https://github.com/ingeniacsc/ingenia-xeokit-runtime/tree/${zeroRevision}`,
  ALLOW_CANDIDATE_REVISION: "true",
};

async function source(relativePath) {
  return readFile(path.join(runtimeRoot, relativePath), "utf8");
}

test("root license preserves the pinned xeokit license across platform line endings", async () => {
  const [rootLicense, dependencyLicense] = await Promise.all([
    readFile(path.join(runtimeRoot, "LICENSE"), "utf8"),
    readFile(path.join(runtimeRoot, "node_modules/@xeokit/xeokit-sdk/LICENSE"), "utf8"),
  ]);
  const normalizeLineEndings = (value) => value.replace(/\r\n/g, "\n");
  assert.equal(normalizeLineEndings(rootLicense), normalizeLineEndings(dependencyLicense));
});

test("publication scripts and legal evidence are wired into the package", async () => {
  const manifest = JSON.parse(await source("package.json"));
  assert.equal(manifest.license, "AGPL-3.0-only");
  for (const name of ["sbom:generate", "validate:publication", "verify:image", "security:audit"]) {
    assert.equal(typeof manifest.scripts[name], "string");
  }
  for (const relativePath of ["NOTICE", "THIRD_PARTY_NOTICES", "SOURCE_OFFER.md", "SBOM.md"]) {
    assert.ok((await source(relativePath)).trim().length > 80, `${relativePath} is incomplete`);
  }
});

test("release metadata is exact and all-zero revisions are candidate-only", () => {
  assert.throws(
    () => validateReleaseMetadata({ ...candidateEnvironment, ALLOW_CANDIDATE_REVISION: "false" }),
    /candidate evidence only/,
  );
  assert.throws(
    () => validateReleaseMetadata({ ...candidateEnvironment, RELEASE_SOURCE_URL: "https://example.invalid" }),
    /exact RELEASE_REVISION/,
  );
  assert.equal(validateReleaseMetadata(candidateEnvironment).revision, zeroRevision);
});

test("SPDX normalization is deterministic for fixed release metadata", () => {
  const raw = {
    spdxVersion: "SPDX-2.3",
    name: "volatile",
    documentNamespace: "https://example.invalid/volatile",
    creationInfo: { created: "2020-01-01T00:00:00.000Z", creators: ["Tool: npm"] },
    packages: [
      { SPDXID: "SPDXRef-Package-root", name: "ingenia-xeokit-runtime" },
      {
        SPDXID: "SPDXRef-Package-converter",
        name: "@xeokit/xeokit-convert",
        versionInfo: "1.3.2",
      },
    ],
  };
  const metadata = validateReleaseMetadata(candidateEnvironment);
  assert.deepEqual(
    normalizeSpdxDocument(raw, metadata),
    normalizeSpdxDocument(structuredClone(raw), metadata),
  );
});

test("artifact SBOM scopes reject cross-artifact contamination and unknown output paths", () => {
  const metadata = validateReleaseMetadata(candidateEnvironment);
  const viewer = {
    spdxVersion: "SPDX-2.3",
    packages: [
      { name: "@ingenia/xeokit-viewer", SPDXID: "SPDXRef-viewer" },
      { name: "@xeokit/xeokit-sdk", versionInfo: "2.6.107", SPDXID: "SPDXRef-sdk" },
    ],
    relationships: [{ spdxElementId: "SPDXRef-viewer", relationshipType: "DEPENDS_ON", relatedSpdxElement: "SPDXRef-sdk" }],
  };
  const normalized = normalizeSpdxDocument(viewer, metadata, "viewer");
  assert.deepEqual(normalized.relationships, viewer.relationships);
  assert.match(normalized.documentNamespace, /\/viewer$/);
  const contaminated = structuredClone(viewer);
  contaminated.packages.push({ name: "@xeokit/xeokit-convert", versionInfo: "1.3.2" });
  assert.throws(() => normalizeSpdxDocument(contaminated, metadata, "viewer"), /exclude the converter/);
  const converter = { spdxVersion: "SPDX-2.3", packages: [
    { name: "@ingenia/xeokit-converter" },
    { name: "@xeokit/xeokit-convert", versionInfo: "1.3.2" },
  ] };
  assert.match(normalizeSpdxDocument(converter, metadata, "converter").documentNamespace, /\/converter$/);
  converter.packages.push({ name: "@ingenia/xeokit-viewer" });
  assert.throws(() => normalizeSpdxDocument(converter, metadata, "converter"), /exclude the Viewer/);
  assert.throws(() => resolveSbomScope("../elsewhere"), /SBOM_SCOPE/);
  assert.throws(() => sbomArguments("toString"), /SBOM_SCOPE/);
  assert.equal(resolveSbomScope("source").output, "sbom.spdx.json");
  assert.ok(sbomArguments("viewer").includes("--include-workspace-root=false"));
  assert.ok(sbomArguments("converter").includes("@ingenia/xeokit-converter"));
});

test("real lock-derived Viewer SBOM excludes uninstalled converter workspace dependencies", () => {
  // Exercise npm's virtual lock graph rather than only inspecting command flags.
  // This must also work in a Viewer-only install where the converter is absent.
  const raw = generateRawSpdx("viewer");
  const document = normalizeSpdxDocument(raw, validateReleaseMetadata(candidateEnvironment), "viewer");
  const names = new Set(document.packages.map((entry) => entry.name));
  for (const name of ["@ingenia/xeokit-viewer", "@ingenia/generic-bim-viewport-protocol", "@xeokit/xeokit-sdk"]) {
    assert.ok(names.has(name), `${name} must be in the Viewer graph`);
  }
  for (const name of ["@ingenia/xeokit-converter", "@xeokit/xeokit-convert", "@loaders.gl/polyfills", "get-pixels", "request", "web-ifc", "vite", "texture-compressor", "image-size"]) {
    assert.equal(names.has(name), false, `${name} must not be in the Viewer graph`);
  }
  assert.match(document.comment, /lock-derived/);
});

test("container publishes source identity, legal evidence and reviewed headers", async () => {
  const [dockerfile, converterDockerfile, nginx, compose, index] = await Promise.all([
    source("docker/Dockerfile"),
    source("docker/Converter.Dockerfile"),
    source("docker/nginx.conf"),
    source("docker/docker-compose.yml"),
    source("packages/viewer/index.html"),
  ]);
  for (const label of ["image.source", "image.revision", "image.version", "image.licenses"]) {
    assert.match(dockerfile, new RegExp(label.replace(".", "\\.")));
  }
  assert.match(dockerfile, /COPY --chmod=644 LICENSE NOTICE THIRD_PARTY_NOTICES \/usr\/share\/nginx\/html\/legal\//);
  assert.match(dockerfile, /SBOM_SCOPE=viewer/);
  assert.match(dockerfile, /COPY --from=build --chmod=644 \/src\/sbom\.viewer\.spdx\.json/);
  assert.match(dockerfile, /USER 101:101/);
  assert.match(dockerfile, /viewer-entrypoint\.sh/);
  assert.match(compose, /\/tmp:rw,noexec,nosuid,size=32m,mode=1777/);
  assert.doesNotMatch(compose, /cap_add:/);
  assert.match(dockerfile, /source\.json/);
  assert.equal((dockerfile.match(/FROM .+@sha256:[0-9a-f]{64}/g) ?? []).length, 2);
  assert.match(dockerfile, /ALLOW_CANDIDATE_REVISION=false/);
  assert.match(converterDockerfile, /npm run converter:prepare/);
  assert.match(converterDockerfile, /org\.opencontainers\.image\.source/);
  assert.match(converterDockerfile, /ALLOW_CANDIDATE_REVISION=false/);
  assert.match(nginx, /rel="source"/);
  assert.match(nginx, /frame-ancestors \$\{XEOKIT_FRAME_ANCESTORS\}/);
  assert.match(nginx, /connect-src 'self' \$\{XEOKIT_CONNECT_SRC\}/);
  assert.match(index, /href="%VITE_SOURCE_URL%"/);
  assert.match(compose, new RegExp(zeroRevision));
  assert.match(compose, /ALLOW_CANDIDATE_REVISION: "true"/);
});

test("publication scanner passes the candidate and blocks high-risk examples", async () => {
  assert.deepEqual(await scanPublicTree(), []);
  const token = ["gh", "p", "_", "A".repeat(24)].join("");
  assert.equal(scanText(`credential=${token}`, "fixture.txt").some((item) => item.rule === "github-token"), true);
  const projectCode = ["R", "T", "N"].join("");
  assert.equal(scanText(`project=${projectCode}`, "fixture.txt").some((item) => item.rule === "customer-project-code"), true);
  assert.equal(scanText("service=http://10.1.2.3:8000", "fixture.txt").some((item) => item.rule === "internal-origin"), true);
});

test("public CI and release workflows pin every third-party action", async () => {
  const workflows = await Promise.all([
    source(".github/workflows/ci.yml"),
    source(".github/workflows/release.yml"),
  ]);
  for (const workflow of workflows) {
    const uses = [...workflow.matchAll(/^\s*uses:\s*([^\s]+)\s*$/gm)].map((match) => match[1]);
    assert.ok(uses.length > 0, "workflow has no external actions");
    for (const action of uses) {
      assert.match(action, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/);
    }
    assert.match(workflow, /permissions:/);
    assert.doesNotMatch(workflow, /pull_request_target:/);
  }
});

test("public repository hygiene and copyright identity stay consistent", async () => {
  const [gitignore, notice, protocolLicense, converterReadme] = await Promise.all([
    source(".gitignore"),
    source("NOTICE"),
    source("packages/protocol/LICENSE"),
    source("packages/converter/README.md"),
  ]);

  for (const requiredPattern of [
    /node_modules\//,
    /dist\//,
    /coverage\//,
    /\.env\.\*/,
    /\*\.log/,
    /\*\.pem/,
    /\*\.key/,
  ]) {
    assert.match(gitignore, requiredPattern);
  }

  await assert.rejects(source("pnpm-workspace.yaml"), { code: "ENOENT" });

  const copyright =
    "Copyright (c) 2026 Nguyễn Thế Dương, operating under the INGENIA trademark.";
  assert.match(notice, new RegExp(copyright.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(
    protocolLicense,
    new RegExp(copyright.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.match(converterReadme, /six ESM\s+import strings across five files/);
});
