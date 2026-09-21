import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const file = path => new URL(`../../${path}`, import.meta.url);
const sha = b => createHash("sha256").update(b).digest("hex");

test("zlib backport pins the upstream fix and regression source", async () => {
  const m = JSON.parse(await readFile(file("docker/zlib-sources.json"), "utf8"));
  assert.equal(m.upstream_fix_commit, "df84af25dc1942490e1d1c899a07619152a46148");
  assert.equal(m.package_version, "1.3.2-r1001");
  assert.equal(sha(await readFile(file(`docker/patches/${m.patch.name}`))), m.patch.sha256);
  assert.equal(sha(await readFile(file(`docker/tests/${m.regression.name}`))), m.regression.sha256);
  assert.notEqual(m.patch.before_sha256, m.patch.after_sha256);
  assert.equal(m.regression.baseline_exit, 42);
  assert.equal(m.regression.patched_exit, 0);
});

test("zlib offline package installation preserves existing BusyBox security", async () => {
  const docker = await readFile(file("docker/Dockerfile"), "utf8");
  const script = await readFile(file("docker/build-patched-zlib.sh"), "utf8");
  assert.match(docker, /FROM busybox-backport AS zlib-backport/);
  assert.match(docker, /RUN --network=none SOURCE_DATE_EPOCH=.*\n\s+\/bin\/sh \/zlib-security\/build-patched-zlib.sh build/);
  assert.match(docker, /apk info --exists 'zlib=1\.3\.2-r1001'/);
  assert.match(docker, /busybox=1\.37\.0-r3101/);
  assert.doesNotMatch(docker, /--allow-untrusted/);
  assert.match(script, /\['abuild', '-F', '-d', '-K'/);
  assert.match(script, /baseline_result\['exit'\] == 42/);
  assert.match(script, /patched_result\['exit'\] == 0/);
  assert.doesNotMatch(script, /SKIP_CHECK|SKIP_TEST|--nocheck/);
});
