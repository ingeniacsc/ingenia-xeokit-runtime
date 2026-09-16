#!/bin/sh
# Fetch hash-pinned inputs using the existing Node builder, then rebuild Alpine
# packages offline in the separate toolchain stage. No runtime input is trusted
# merely because its filename/version resembles the intended package.
set -eu

case "${1:-}" in
fetch)
    exec node --input-type=commonjs - "$2" "$3" "$4" <<'NODE'
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const [manifestPath, patchPath, output] = process.argv.slice(2);
const digest = (bytes, algorithm = 'sha256') => crypto.createHash(algorithm).update(bytes).digest('hex');
const safeName = value => typeof value === 'string' && /^[A-Za-z0-9_.+-]+$/.test(value) && !value.startsWith('.');
async function main() {
  const manifestBytes = await fs.readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schema !== 1 || manifest.aports_commit !== 'c3ef5d10e6ef6528852c51f0564963e2f8c1be19'
      || manifest.package_version !== '1.37.0-r3101'
      || manifest.builder_apks_status !== 'FROZEN'
      || !Array.isArray(manifest.builder_apks) || !manifest.builder_apks.length) {
    throw new Error('Frozen source and builder APK manifest required');
  }
  await fs.mkdir(output, {recursive: true});
  if ((await fs.readdir(output)).length) throw new Error('Input directory must be empty');
  for (const directory of ['aports', 'distfiles', 'apks', 'metadata']) {
    await fs.mkdir(path.join(output, directory));
  }
  const patchBytes = await fs.readFile(patchPath);
  if (digest(patchBytes) !== manifest.backport.sha256 || digest(patchBytes, 'sha512') !== manifest.backport.sha512) {
    throw new Error('Backport patch checksum mismatch');
  }
  await fs.writeFile(path.join(output, 'metadata', 'busybox-sources.json'), manifestBytes, {flag: 'wx'});
  await fs.writeFile(path.join(output, 'metadata', manifest.backport.name), patchBytes, {flag: 'wx'});
  const testPatch = manifest.build_test_patch;
  if (!testPatch || testPatch.name !== 'busybox-offline-checks.patch') throw new Error('Pinned build-test patch required');
  const testPatchBytes = await fs.readFile(path.join(path.dirname(patchPath), testPatch.name));
  if (testPatchBytes.length !== testPatch.bytes || digest(testPatchBytes) !== testPatch.sha256
      || digest(testPatchBytes, 'sha512') !== testPatch.sha512) {
    throw new Error('Build-test patch checksum mismatch');
  }
  await fs.writeFile(path.join(output, 'metadata', testPatch.name), testPatchBytes, {flag: 'wx'});
  const tasks = [
    ...manifest.aports_files.map(row => ({...row, directory: 'aports'})),
    {...manifest.upstream_source, directory: 'distfiles'},
    ...manifest.builder_apks.map(row => ({...row, directory: 'apks'})),
  ];
  const names = new Set();
  let declaredBytes = 0;
  for (const task of tasks) {
    if (!safeName(task.name) || !/^[a-f0-9]{64}$/.test(task.sha256)
        || !Number.isSafeInteger(task.bytes) || task.bytes <= 0 || task.bytes > 128 * 1024 * 1024) {
      throw new Error('Invalid pinned input');
    }
    const key = `${task.directory}/${task.name}`;
    if (names.has(key)) throw new Error('Duplicate input destination');
    names.add(key);
    const url = new URL(task.url);
    const allowed = task.directory === 'aports'
      ? task.url === `https://raw.githubusercontent.com/alpinelinux/aports/${manifest.aports_commit}/main/busybox/${task.name}`
      : task.directory === 'distfiles'
        ? task.url === 'https://busybox.net/downloads/busybox-1.37.0.tar.bz2'
        : task.url === `https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/${task.name}`;
    if (!allowed || url.username || url.password || url.search || url.hash) throw new Error('Unreviewed input URL');
    declaredBytes += task.bytes;
  }
  if (declaredBytes > 512 * 1024 * 1024) throw new Error('Input budget exceeded');
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      const response = await fetch(task.url, {redirect: 'error', signal: AbortSignal.timeout(120000)});
      if (!response.ok) throw new Error(`Input download failed: ${task.name}`);
      const chunks = [];
      let length = 0;
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > task.bytes) throw new Error(`Input length exceeded: ${task.name}`);
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (length !== task.bytes || digest(bytes) !== task.sha256
          || (task.sha512 && digest(bytes, 'sha512') !== task.sha512)) {
        throw new Error(`Input checksum mismatch: ${task.name}`);
      }
      if (task.git_blob && crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== task.git_blob) {
        throw new Error(`Git blob mismatch: ${task.name}`);
      }
      await fs.writeFile(path.join(output, task.directory, task.name), bytes, {flag: 'wx'});
    }
  }
  await Promise.all(Array.from({length: 4}, worker));
  console.log(JSON.stringify({status: 'PASS_PINNED_INPUTS', files: tasks.length, bytes: declaredBytes,
    manifest_sha256: digest(manifestBytes), backport_sha256: digest(patchBytes)}));
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
NODE
    ;;
build)
    [ "$(apk --print-arch)" = x86_64 ]
    # Every APK was checksum-verified in fetch. Alpine signatures remain
    # mandatory; no network, repository refresh or dependency resolution fetch.
    apk add --no-network /busybox-inputs/apks/*.apk
    exec python3 - <<'PY'
from pathlib import Path
import gzip
import hashlib
import http.server
import io
import json
import os
import shutil
import subprocess
import tarfile
import threading
import time

inputs = Path('/busybox-inputs')
manifest = json.loads((inputs / 'metadata/busybox-sources.json').read_text(encoding='utf-8'))
assert manifest['builder_apks_status'] == 'FROZEN'
assert manifest['package_version'] == '1.37.0-r3101'
epoch = int(os.environ['SOURCE_DATE_EPOCH'])
assert epoch > 0
output = Path('/busybox-output')
assert not output.exists()
output.mkdir()
runtime = output / 'runtime'
legal = output / 'legal'
runtime.mkdir()
legal.mkdir()
work = Path('/busybox-work')
work.mkdir()
recipe = work / 'aports/main/busybox'
shutil.copytree(inputs / 'aports', recipe)
original = (recipe / 'APKBUILD').read_text(encoding='utf-8')
assert '\npkgver=1.37.0\n' in original and '\npkgrel=31\n' in original
patch = manifest['backport']
patch_bytes = (inputs / 'metadata' / patch['name']).read_bytes()
assert hashlib.sha256(patch_bytes).hexdigest() == patch['sha256']
(recipe / patch['name']).write_bytes(patch_bytes)
test_patch = manifest['build_test_patch']
test_patch_bytes = (inputs / 'metadata' / test_patch['name']).read_bytes()
assert hashlib.sha256(test_patch_bytes).hexdigest() == test_patch['sha256']
assert hashlib.sha512(test_patch_bytes).hexdigest() == test_patch['sha512']
(recipe / test_patch['name']).write_bytes(test_patch_bytes)
overlay = (
    '\n# INGENIA local backport; not an Alpine-issued package revision.\n'
    'pkgrel=3101\n'
    'pkgdesc="$pkgdesc (INGENIA CVE-2025-60876 backport of Alpine r31)"\n'
    'source="$source ' + patch['name'] + ' ' + test_patch['name'] + '"\n'
    'sha512sums="$sha512sums\n' + patch['sha512'] + '  ' + patch['name'] + '\n'
    + test_patch['sha512'] + '  ' + test_patch['name'] + '\n"\n'
)
(recipe / 'APKBUILD').write_text(original + overlay, encoding='utf-8', newline='\n')
signing = work / 'signing'
signing.mkdir(mode=0o700)
key = signing / 'ingenia-busybox-backport.rsa'
public_key = signing / 'ingenia-busybox-backport.rsa.pub'
subprocess.run(['openssl', 'genrsa', '-out', str(key), '2048'], check=True)
key.chmod(0o600)
subprocess.run(['openssl', 'rsa', '-in', str(key), '-pubout', '-out', str(public_key)], check=True)
# The build tool verifies the local repository index using the same public key.
# The private signing key remains exclusively in the builder signing directory.
shutil.copyfile(public_key, Path('/etc/apk/keys') / public_key.name)
env = dict(os.environ, PACKAGER_PRIVKEY=str(key), ABUILD_USERDIR=str(signing),
           SRCDEST=str(inputs / 'distfiles'), REPODEST=str(work / 'packages'),
           JOBS='2', MAKEFLAGS='-j2', SOURCE_DATE_EPOCH=str(epoch))
# The four original HTTP assertions run against a deterministic local response.
# No internet test is skipped and no external network is enabled.
env.pop('SKIP_INTERNET_TESTS', None)
suite_wget_enabled = {}
for config_name in ['busyboxconfig', 'busyboxconfig-extras']:
    config_lines = (inputs / 'aports' / config_name).read_text(encoding='utf-8').splitlines()
    enabled = 'CONFIG_WGET=y' in config_lines
    disabled = '# CONFIG_WGET is not set' in config_lines
    assert enabled != disabled, config_name
    suite_wget_enabled[config_name] = enabled
expected_http_requests = 4 * sum(suite_wget_enabled.values())
assert expected_http_requests >= test_patch['minimum_successful_requests']
fixture_body = b'INGENIA BusyBox offline HTTP fixture\n'
fixture_state = {'successful_requests': 0, 'errors': []}
fixture_deadline = time.monotonic() + 1210

class FixtureHandler(http.server.BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(2)

    def log_message(self, *args):
        pass

    def do_GET(self):
        if (self.path != '/' or time.monotonic() > fixture_deadline
                or fixture_state['successful_requests'] >= expected_http_requests):
            if len(fixture_state['errors']) < 8:
                fixture_state['errors'].append('unexpected_or_excess_request')
            self.send_error(503)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.send_header('Content-Length', str(len(fixture_body)))
        self.end_headers()
        self.wfile.write(fixture_body)
        fixture_state['successful_requests'] += 1

class FixtureServer(http.server.HTTPServer):
    def handle_error(self, request, client_address):
        if len(fixture_state['errors']) < 8:
            fixture_state['errors'].append('handler_error')

fixture = FixtureServer(('127.0.0.1', 18080), FixtureHandler)
fixture_thread = threading.Thread(target=fixture.serve_forever,
                                  kwargs={'poll_interval': 0.1}, daemon=True)
fixture_thread.start()
# -d skips dependency installation because the complete closure is installed.
# -K retains builder-only source/temp dirs for the mandatory post-build hashes.
# Docker runs this entire step with --network=none. The original recipe's
# prepare/build/check/package steps and configuration remain in force.
try:
    subprocess.run(['abuild', '-F', '-d', '-K', '-P', str(work / 'packages'), 'all'],
                   cwd=recipe, env=env, check=True, timeout=1200)
finally:
    fixture.shutdown()
    fixture_thread.join(timeout=3)
    fixture.server_close()
assert not fixture_thread.is_alive(), 'HTTP fixture did not stop'
assert fixture_state == {'successful_requests': expected_http_requests, 'errors': []}, fixture_state
for target in test_patch['targets']:
    actual = recipe / 'src/busybox-1.37.0' / target['path']
    assert hashlib.sha256(actual.read_bytes()).hexdigest() == target['after_sha256'], target['path']
packages = []
for package in ['busybox', 'busybox-binsh', 'ssl_client']:
    filename = f'{package}-{manifest["package_version"]}.apk'
    found = list((work / 'packages').rglob(filename))
    assert len(found) == 1, filename
    data = found[0].read_bytes()
    (runtime / filename).write_bytes(data)
    packages.append({'name': package, 'version': manifest['package_version'], 'file': filename,
                     'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
shutil.copyfile(public_key, runtime / public_key.name)
provenance = {
    'schema': 1, 'vulnerability': 'CVE-2025-60876', 'status': 'BACKPORT_BUILT_NOT_RUNTIME_ACCEPTANCE',
    'upstream_version': '1.37.0', 'alpine_base_revision': 31, 'ingenia_revision': 3101,
    'aports_commit': manifest['aports_commit'], 'backport_sha256': patch['sha256'],
    'manifest_sha256': hashlib.sha256((inputs / 'metadata/busybox-sources.json').read_bytes()).hexdigest(),
    'public_signing_key_sha256': hashlib.sha256(public_key.read_bytes()).hexdigest(),
    'source_date_epoch': epoch, 'packages': packages,
    'build_test_patch_sha256': test_patch['sha256'],
    'build_test_fixture': {'origin': test_patch['fixture_origin'],
                           'successful_requests': fixture_state['successful_requests'],
                           'expected_successful_requests': expected_http_requests,
                           'suite_wget_enabled': suite_wget_enabled,
                           'body_sha256': hashlib.sha256(fixture_body).hexdigest(),
                           'body_bytes': len(fixture_body), 'errors': fixture_state['errors'],
                           'test_files_sha256_verified': len(test_patch['targets']),
                           'internet_tests_skipped': False},
    'builder_packages': subprocess.check_output(['apk', 'info', '-v'], text=True).splitlines(),
    'predicate': patch['predicate'], 'raw_wire_regression': 'REQUIRED_ON_FINAL_IMAGE',
    'scanner_warning': 'Unchanged upstream 1.37.0 can still match a broad CPE rule; no suppression applied.',
}
(legal / 'busybox-backport.json').write_text(json.dumps(provenance, indent=2) + '\n', encoding='utf-8')
shutil.copyfile(inputs / 'metadata/busybox-sources.json', legal / 'busybox-sources.json')
shutil.copyfile(public_key, legal / public_key.name)
# Only explicitly selected public source inputs enter the legal archive.
# No work directory, private signing key, toolchain APKs or credentials enter it.
members = [(inputs / 'aports' / row['name'], 'alpine-original/' + row['name'])
           for row in manifest['aports_files']]
members += [
    (inputs / 'distfiles' / manifest['upstream_source']['name'], manifest['upstream_source']['name']),
    (recipe / 'APKBUILD', 'ingenia/APKBUILD'),
    (recipe / patch['name'], 'ingenia/' + patch['name']),
    (recipe / test_patch['name'], 'ingenia/' + test_patch['name']),
    (inputs / 'metadata/busybox-sources.json', 'ingenia/busybox-sources.json'),
    (Path('/security/build-patched-busybox.sh'), 'ingenia/build-patched-busybox.sh'),
    (Path('/security/Dockerfile'), 'ingenia/Dockerfile'),
    (Path('/security/BUSYBOX_SECURITY.md'), 'ingenia/BUSYBOX_SECURITY.md'),
]
with (legal / 'busybox-corresponding-source.tar.gz').open('wb') as target:
    with gzip.GzipFile(fileobj=target, mode='wb', mtime=epoch, filename='') as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as archive:
            for source, name in sorted(members, key=lambda member: member[1]):
                data = source.read_bytes()
                info = tarfile.TarInfo(name)
                info.size, info.mtime, info.mode = len(data), epoch, 0o644
                info.uid = info.gid = 0
                archive.addfile(info, io.BytesIO(data))
print(json.dumps({'status': 'PASS_BACKPORT_BUILD', 'packages': packages,
                  'source_archive_sha256': hashlib.sha256((legal / 'busybox-corresponding-source.tar.gz').read_bytes()).hexdigest()}))
PY
    ;;
*)
    printf '%s\n' 'Usage: build-patched-busybox.sh fetch MANIFEST PATCH OUTPUT | build' >&2
    exit 2
    ;;
esac
