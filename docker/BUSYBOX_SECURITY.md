# BusyBox CVE-2025-60876 backport

The Viewer retains the pinned nginx Alpine runtime and its original POSIX
shell, envsubst and wget interfaces. It rebuilds BusyBox from the complete
Alpine 3.24 recipe at commit `c3ef5d10e6ef6528852c51f0564963e2f8c1be19`,
preserving its configuration and existing patch set, then applies the downstream
CVE fix. This is remediation of the executable, not risk acceptance or a
scanner exclusion. Browser Viewer code, the protocol and converter are unchanged.

## Authoritative sources and identity

- [BusyBox/SUSE submission, 21 November 2025](https://lists.busybox.net/pipermail/busybox/2025-November/091840.html).
- [Buildroot adoption](https://gitlab.com/buildroot.org/buildroot/-/commit/073c6af03e765c930e01da56c78f2770bdfb52a6).
- [Exact vendored patch](https://raw.githubusercontent.com/buildroot/buildroot/073c6af03e765c930e01da56c78f2770bdfb52a6/package/busybox/0014-wget-dont-allow-control-characters-or-spaces-in-the-URL.patch):
  SHA256 `0506f13375c2425d2ff46a453616a9cb88de1a0c6878d26cd5fdc8ae9ebea51f`.
- [Upstream BusyBox 1.37.0 source](https://busybox.net/downloads/busybox-1.37.0.tar.bz2):
  SHA256 `3311dff32e746499f4df0d5df04d7eb396382d7e108bb9250e7b519b837043a4`.
- The full file URLs, Git object IDs, SHA256/SHA512 and frozen builder APK
  closure are recorded in `busybox-sources.json`. Fetch rejects missing closure,
  changed hashes, unexpected URLs and oversized inputs. The build/install phase
  has no network and retains APK signature validation.

`1.37.0-r3101` is an **INGENIA local package revision based on Alpine r31**,
not an Alpine-issued security release or an invented newer upstream version.
The rebuilt `busybox`, `busybox-binsh` and `ssl_client` packages share this
revision. The binary still truthfully reports upstream BusyBox 1.37.0. A fresh
scanner can retain broad upstream-version/CPE matches; preserve those raw
findings and bind the backport proof to actual executable/package hashes.

An ephemeral build-only RSA key signs the local APKs. Only its public key is
installed in the image and included in provenance. Private keys are excluded
from the final stage and all legal/source bundles. No `--allow-untrusted`, APK
database edits, source-version masking or vulnerability suppression is used.

## Exact behavior and regression contract

The unmodified nine-line downstream patch rejects input bytes from 0x01 through
0x20 before parsing a URL. This rejects raw CR, LF, C0 controls and spaces in
host/path/query, including URLs used through an HTTP proxy or after redirects.
NUL cannot occur inside a process argument. The patch does not reject DEL0x7f;
do not claim otherwise or silently broaden its meaning. Percent-encoded text
such as `%20` and `%0D%0A` remains encoded on the HTTP request line.

Release acceptance requires an isolated raw-TCP fixture: the previous exact
image reproduces injected request headers; the rebuilt final image emits no
forged request/header bytes for the same inputs. Test both PATH `wget` and
`/bin/busybox wget`, direct/proxy/redirect paths, and ordinary/encoded URL success.
Record command results and actual wire bytes safely from synthetic data only.

Also verify the real normal entrypoint, nginx configuration/CSP substitution,
UID101, readonly root/tmpfs, no published host ports, fixed-loopback wget
healthcheck, static-file hashes, gzip/Range, legal endpoints and the full Viewer
test suite. The final package inventory and OS SBOM must show the rebuilt APKs
and actual executable hashes. Existing image receipts are not new-image proof.

## Corresponding source and build

The image serves `/legal/busybox-corresponding-source.tar.gz`, containing the
upstream source archive, all 80 original Alpine recipe/config/patch files, the
applied recipe and backport, input manifest and build instructions. It also
serves `/legal/busybox-backport.json`, `/legal/busybox-sources.json` and the
public package verification key. These are additional to the existing Viewer
license and source offer. BusyBox retains its GPL-2.0-only licensing.

Build Linux/amd64 with the existing exact-source Docker recipe, a real source
commit/URL, a positive commit epoch and production-only origins. Three external
base stages are digest-pinned. The BusyBox stage runs the original Alpine
prepare/build/check/package recipe with two compiler jobs and a 20-minute
timeout; reserve approximately 1GiB RAM and 1GiB temporary disk, then measure
actual usage. The source archive adds approximately 3MiB to the final image.
These are planning estimates, not measured release evidence. No build tools,
toolchain APKs or private build keys enter the final runtime.

## Original test-suite portability

The initial offline build retained its complete failure log: 898 tests passed
and five failed. Four old wget tests depended on downloading Google's live
homepage. The remaining test expected the `Z` suffix for a date, whereas the
pinned musl 1.2.6 implementation of `strptime(%z)` accepts signed numeric offsets.
The published baseline image also rejects this suffix; it accepts `+0000`.
This is a pre-existing libc limitation, not a change to date behavior here.
See the [musl implementation](https://git.musl-libc.org/cgit/musl/plain/src/time/strptime.c?h=v1.2.6).

`busybox-offline-checks.patch` changes exactly five test files, without changing
runtime C code or configuration. The first date input uses the equivalent
numeric UTC offset `+0000`, retaining all seven expected date/DST/offset results.
Four Google URL inputs become `http://127.0.0.1:18080`; the empty path and all
download, nonempty-file, `-O` and `-P` assertions remain intact. No internet test
is skipped. The entire original dynamic and extras check phases still run.

A Python HTTP fixture binds only loopback during the offline build, serves a
fixed 37-byte body, caps successful responses/error records and socket duration,
and is stopped on both success and failure. The build derives the expected
request count from both pinned suite configurations and requires that count
with zero fixture errors. For these configurations the count is four because
the extras configuration has no wget applet.
It verifies hashes of all five resulting test files. Patch hashes, original
and resulting test hashes, and fixture evidence are included in the public
manifest/provenance. The corresponding-source archive contains 88 explicit
members, including this separate test-only patch; its five input adjustments
are not represented as additional vulnerability fixes.
