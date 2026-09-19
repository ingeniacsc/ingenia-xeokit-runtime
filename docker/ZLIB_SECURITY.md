# zlib CVE-2026-85091 backport

This runtime retains zlib 1.3.2 with the exact upstream fix
`df84af25dc1942490e1d1c899a07619152a46148`. The fix clears stale external
input state after a nonblocking write failure before a subsequent formatted
write can move that input into the internal buffer.

The Alpine 3.24 packaging recipe is pinned at
`f248b33b5943c7dc69bf691031d7612ab2e8ed93`. Its configure flags, upstream
`make check`, and subpackage definitions are retained. `1.3.2-r1001` is an
INGENIA package revision, not an Alpine-issued fix. The manifest pins source,
recipe, patch, and regression hashes; downloads verify length and SHA-256 and
SHA-512 before an offline build with the existing frozen BusyBox toolchain.

The regression fills a local nonblocking pipe and drives an external-buffer
`gzwrite`. The unpatched library must fail the stale-input-state predicate with
exit 42, before executing the unsafe memory move. The patched library must
restore the internal pointer, tolerate the following `gzprintf`, and pass a
gzip roundtrip. This is a deterministic state regression, not an ASAN or a
remote exploit demonstration. No upstream tests are disabled.

Each build signs the APK with a fresh private key kept only in the builder.
Only the exact APK, public key, corresponding source archive, and provenance
cross into the runtime. The runtime verifies the signature offline and the
exact installed package version. A fresh signing key means byte-identical
signed APK reproduction is not claimed; each artifact has its own hashes.

Release acceptance additionally requires checking the actual layer APK against
the installed library, checking the corresponding source, testing Nginx gzip
and full assets, and scanning the exact final image archive. An unchanged
upstream version may still produce a CPE finding. Keep raw findings and record
the verified backport disposition; do not suppress them or claim zero findings.

The APK may be reused only for a verified compatible Alpine 3.24 x86_64 runtime,
with the same public key and provenance. It does not patch a separately bundled
zlib inside Node or another binary. Existing BusyBox remediation is preserved.

The patch omits its final unchanged blank context line, with matching hunk
lengths, so repository whitespace checks pass. The original download hash is
retained in the manifest; all five upstream changed lines and both source
content hashes remain unchanged.
