import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

test("converter source is exact, rebuildable and separate from private backend", async () => {
  const [manifestText, provenanceText, wrapper, patch, dockerfile] = await Promise.all([
    read("packages/converter/package.json"),
    read("packages/converter/UPSTREAM_PROVENANCE.json"),
    read("packages/converter/bin/ingenia-xeokit-convert.mjs"),
    read("packages/converter/scripts/patch-loaders-polyfills.mjs"),
    read("docker/Converter.Dockerfile"),
  ]);
  const manifest = JSON.parse(manifestText);
  const provenance = JSON.parse(provenanceText);
  assert.equal(manifest.dependencies["@xeokit/xeokit-convert"], "1.3.2");
  assert.equal(provenance.version, "1.3.2");
  assert.equal(provenance.upstreamCommit, "9b2258bf0dc49f3ff67a594c0309724f36c921a2");
  assert.match(wrapper, /spawn\(process\.execPath/);
  assert.match(patch, /@loaders\.gl\/polyfills/);
  assert.match(dockerfile, /npm ci --ignore-scripts --omit=dev/);
  assert.match(dockerfile, /--workspace @ingenia\/xeokit-converter --include-workspace-root=false/);
  assert.match(dockerfile, /SBOM_SCOPE=converter/);
  assert.match(dockerfile, /cp \/src\/sbom\.converter\.spdx\.json \/licenses\/sbom\.spdx\.json/);
  assert.doesNotMatch(`${wrapper}\n${patch}`, /django|celery|projectmembership|auth_token/i);
});

test("human notices identify the converter and exact public source obligations", async () => {
  const [notice, thirdParty, offer] = await Promise.all([
    read("NOTICE"),
    read("THIRD_PARTY_NOTICES"),
    read("SOURCE_OFFER.md"),
  ]);
  assert.match(notice, /Nguyễn Thế Dương/);
  assert.match(thirdParty, /@xeokit\/xeokit-convert 1\.3\.2/);
  assert.match(offer, /Viewer and Converter/);
});
