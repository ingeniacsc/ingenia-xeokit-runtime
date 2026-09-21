#!/bin/sh
# Hash-pinned source fetch followed by an offline signed Alpine zlib backport.
set -eu
case "${1:-}" in
fetch)
  exec node --input-type=commonjs - "$2" "$3" <<'NODE'
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const [source, output] = process.argv.slice(2);
const hash = (b, a = 'sha256') => crypto.createHash(a).update(b).digest('hex');
async function main() {
  const raw = await fs.readFile(path.join(source, 'zlib-sources.json'));
  const manifest = JSON.parse(raw);
  if (manifest.schema !== 1 || manifest.package_version !== '1.3.2-r1001'
      || manifest.aports_commit !== 'f248b33b5943c7dc69bf691031d7612ab2e8ed93'
      || manifest.upstream_fix_commit !== 'df84af25dc1942490e1d1c899a07619152a46148') {
    throw new Error('Unexpected zlib source identity');
  }
  await fs.mkdir(output, {recursive: true});
  if ((await fs.readdir(output)).length) throw new Error('Nonempty zlib inputs');
  await fs.writeFile(path.join(output, 'zlib-sources.json'), raw, {flag: 'wx'});
  const expected = new Map([
    ['APKBUILD', `https://raw.githubusercontent.com/alpinelinux/aports/${manifest.aports_commit}/main/zlib/APKBUILD`],
    ['zlib-1.3.2.tar.gz', 'https://zlib.net/fossils/zlib-1.3.2.tar.gz'],
  ]);
  for (const row of [manifest.recipe, manifest.source]) {
    if (expected.get(row.name) !== row.url || !Number.isSafeInteger(row.bytes)
        || row.bytes <= 0 || row.bytes > 4 * 1024 * 1024) throw new Error('Unreviewed input');
    const response = await fetch(row.url, {redirect: 'error', signal: AbortSignal.timeout(180000)});
    if (!response.ok) throw new Error(`Source fetch failed: ${row.name}`);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > row.bytes) throw new Error('Input byte limit exceeded');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (size !== row.bytes || hash(bytes) !== row.sha256 || hash(bytes, 'sha512') !== row.sha512) {
      throw new Error(`Source hash mismatch: ${row.name}`);
    }
    await fs.writeFile(path.join(output, row.name), bytes, {flag: 'wx'});
  }
  for (const row of [manifest.patch, manifest.regression]) {
    if (!/^[A-Za-z0-9_.-]+$/.test(row.name)) throw new Error('Unsafe local input');
    const bytes = await fs.readFile(path.join(source, row.name));
    if (hash(bytes) !== row.sha256 || (row.sha512 && hash(bytes, 'sha512') !== row.sha512)) {
      throw new Error('Local zlib input hash mismatch');
    }
    await fs.writeFile(path.join(output, row.name), bytes, {flag: 'wx'});
  }
  console.log(JSON.stringify({status: 'PASS_ZLIB_PINNED_INPUTS', manifest_sha256: hash(raw)}));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
NODE
  ;;
build)
  [ "$(apk --print-arch)" = x86_64 ]
  exec python3 - <<'PY'
from pathlib import Path
import gzip
import hashlib
import io
import json
import os
import shutil
import subprocess
import tarfile

inputs = Path('/zlib-inputs')
manifest = json.loads((inputs / 'zlib-sources.json').read_text(encoding='utf-8'))
assert manifest['package_version'] == '1.3.2-r1001'
epoch = int(os.environ['SOURCE_DATE_EPOCH'])
assert epoch > 0
output = Path('/zlib-output')
assert not output.exists()
runtime, legal, work = output / 'runtime', output / 'legal', Path('/zlib-work')
for p in (runtime, legal, work): p.mkdir(parents=True)
hash_bytes = lambda b: hashlib.sha256(b).hexdigest()
for key in ('recipe', 'source', 'patch', 'regression'):
    row = manifest[key]
    data = (inputs / row['name']).read_bytes()
    assert hash_bytes(data) == row['sha256'], row['name']

# A private isolated source tree proves the baseline predicate without executing
# the unsafe baseline gz_vacate memmove. No changed test or disabled check.
baseline = work / 'baseline'
baseline.mkdir()
with tarfile.open(inputs / manifest['source']['name'], 'r:gz') as archive:
    for member in archive.getmembers():
        target = (baseline / member.name).resolve()
        assert target.is_relative_to(baseline.resolve())
        assert member.isfile() or member.isdir(), member.name
    archive.extractall(baseline, filter='data')
base_src = baseline / 'zlib-1.3.2'
assert hash_bytes((base_src / 'gzwrite.c').read_bytes()) == manifest['patch']['before_sha256']
subprocess.run(['./configure', '--static', '--disable-crcvx'], cwd=base_src, check=True)
subprocess.run(['make', '-j2'], cwd=base_src, check=True)
regression = inputs / manifest['regression']['name']
def regression_result(source, binary):
    subprocess.run(['cc', '-O2', '-I', str(source), str(regression), str(source / 'libz.a'),
                    '-o', str(binary)], check=True)
    r = subprocess.run([str(binary)], capture_output=True, text=True, timeout=15)
    return {'exit': r.returncode, 'stdout': r.stdout, 'stderr': r.stderr}
baseline_result = regression_result(base_src, work / 'baseline-regression')
assert baseline_result['exit'] == 42
assert 'BASELINE_VULNERABLE_STALE_EXTERNAL_INPUT' in baseline_result['stdout']

recipe = work / 'aports/main/zlib'
recipe.mkdir(parents=True)
original = (inputs / 'APKBUILD').read_text(encoding='utf-8')
assert '\npkgver=1.3.2\n' in original and '\npkgrel=0\n' in original
patch = manifest['patch']
shutil.copyfile(inputs / patch['name'], recipe / patch['name'])
overlay = ('\n# INGENIA signed local backport, not an Alpine-issued package revision.\n'
           'pkgrel=1001\n'
           'pkgdesc="$pkgdesc (INGENIA CVE-2026-85091 backport of Alpine r0)"\n'
           'source="$source ' + patch['name'] + '"\n'
           'sha512sums="$sha512sums\n' + patch['sha512'] + '  ' + patch['name'] + '\n"\n')
(recipe / 'APKBUILD').write_text(original + overlay, encoding='utf-8', newline='\n')
signing = work / 'signing'
signing.mkdir(mode=0o700)
key = signing / 'ingenia-zlib-backport.rsa'
public = signing / 'ingenia-zlib-backport.rsa.pub'
subprocess.run(['openssl', 'genrsa', '-out', str(key), '2048'], check=True)
key.chmod(0o600)
subprocess.run(['openssl', 'rsa', '-in', str(key), '-pubout', '-out', str(public)], check=True)
shutil.copyfile(public, Path('/etc/apk/keys') / public.name)
env = dict(os.environ, PACKAGER_PRIVKEY=str(key), ABUILD_USERDIR=str(signing),
           SRCDEST=str(inputs), REPODEST=str(work / 'packages'), JOBS='2', MAKEFLAGS='-j2',
           SOURCE_DATE_EPOCH=str(epoch))
subprocess.run(['abuild', '-F', '-d', '-K', '-P', str(work / 'packages'), 'all'],
               cwd=recipe, env=env, check=True, timeout=300)
patched_src = recipe / 'src/zlib-1.3.2'
assert hash_bytes((patched_src / 'gzwrite.c').read_bytes()) == patch['after_sha256']
patched_result = regression_result(patched_src, work / 'patched-regression')
assert patched_result['exit'] == 0, patched_result
assert 'PASS_STALLED_WRITE_AND_GZPRINTF_BOUNDARY' in patched_result['stdout']
assert 'PASS_GZIP_ROUNDTRIP' in patched_result['stdout']

filename = 'zlib-1.3.2-r1001.apk'
found = list((work / 'packages').rglob(filename))
assert len(found) == 1
data = found[0].read_bytes()
(runtime / filename).write_bytes(data)
shutil.copyfile(public, runtime / public.name)
provenance = {'schema': 1, 'vulnerability': manifest['vulnerability'],
    'status': 'BACKPORT_BUILT_REQUIRES_FINAL_IMAGE_PROOF',
    'package': {'name': 'zlib', 'version': manifest['package_version'], 'file': filename,
                'sha256': hash_bytes(data), 'bytes': len(data)},
    'aports_commit': manifest['aports_commit'], 'upstream_fix_commit': manifest['upstream_fix_commit'],
    'source_date_epoch': epoch, 'manifest_sha256': hash_bytes((inputs / 'zlib-sources.json').read_bytes()),
    'patch_sha256': patch['sha256'], 'gzwrite_after_sha256': patch['after_sha256'],
    'public_signing_key_sha256': hash_bytes(public.read_bytes()),
    'regression': {'baseline': baseline_result, 'patched': patched_result,
                   'input_sha256': manifest['regression']['sha256'],
                   'scope': 'Nonblocking write-state invariant, subsequent gzprintf, gzip roundtrip; no ASAN claim.'},
    'upstream_make_check': 'PASS_UNMODIFIED_ALPINE_RECIPE',
    'builder_packages': subprocess.check_output(['apk', 'info', '-v'], text=True).splitlines(),
    'scanner_warning': 'Unchanged upstream version may still match CPE rules; retain raw finding without suppression.'}
(legal / 'zlib-backport.json').write_text(json.dumps(provenance, indent=2) + '\n', encoding='utf-8')
shutil.copyfile(inputs / 'zlib-sources.json', legal / 'zlib-sources.json')
shutil.copyfile(public, legal / public.name)
members = [(inputs / 'APKBUILD', 'alpine-original/APKBUILD'),
           (inputs / manifest['source']['name'], manifest['source']['name']),
           (recipe / 'APKBUILD', 'ingenia/APKBUILD'),
           (inputs / patch['name'], 'ingenia/' + patch['name']),
           (regression, 'ingenia/' + regression.name),
           (inputs / 'zlib-sources.json', 'ingenia/zlib-sources.json'),
           (Path('/zlib-security/build-patched-zlib.sh'), 'ingenia/build-patched-zlib.sh'),
           (Path('/zlib-security/Dockerfile'), 'ingenia/Dockerfile'),
           (Path('/zlib-security/ZLIB_SECURITY.md'), 'ingenia/ZLIB_SECURITY.md')]
with (legal / 'zlib-corresponding-source.tar.gz').open('wb') as target:
    with gzip.GzipFile(fileobj=target, mode='wb', mtime=epoch, filename='') as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as archive:
            for source, name in sorted(members, key=lambda item: item[1]):
                b = source.read_bytes()
                info = tarfile.TarInfo(name)
                info.size, info.mtime, info.mode = len(b), epoch, 0o644
                info.uid = info.gid = 0
                archive.addfile(info, io.BytesIO(b))
print(json.dumps({'status': 'PASS_ZLIB_BACKPORT_BUILD', 'package': provenance['package'],
                  'regression': provenance['regression'],
                  'source_archive_sha256': hash_bytes((legal / 'zlib-corresponding-source.tar.gz').read_bytes())}))
PY
  ;;
*) echo 'Usage: build-patched-zlib.sh fetch SOURCE OUTPUT | build' >&2; exit 2 ;;
esac
