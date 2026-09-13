# SBOM generation and release binding

The exact Viewer and Converter dependencies are pinned by `package-lock.json`.
The Converter pin is independently recorded in
`packages/converter/UPSTREAM_PROVENANCE.json`. The checked-in
`sbom.spdx.json` is generated from that lockfile, but remains candidate
evidence while its revision is all zeroes.

Release generation is fail-closed:

```sh
SOURCE_DATE_EPOCH=<release timestamp> \
RELEASE_VERSION=<public version> \
RELEASE_REVISION=<40-character public commit> \
RELEASE_SOURCE_URL=https://github.com/ingeniacsc/ingenia-xeokit-runtime/tree/<same commit> \
npm run sbom:generate
```

`SBOM_SCOPE` selects a fixed output and dependency population:

| Scope | Output | Population |
| --- | --- | --- |
| `source` (default) | `sbom.spdx.json` | All production npm dependencies in the source workspace |
| `viewer` | `sbom.viewer.spdx.json` | Viewer and protocol workspace production dependencies |
| `converter` | `sbom.converter.spdx.json` | Converter workspace production dependencies |

Use the same release metadata with `SBOM_SCOPE=viewer npm run sbom:generate`
and `SBOM_SCOPE=converter npm run sbom:generate`. Unknown scopes are rejected;
the output cannot be redirected outside the runtime root. npm selects each
workspace graph from the lockfile and retains its dependency relationships. Converter dependencies
must not appear in the Viewer SBOM; the Viewer workspace and Vite must not appear
in the Converter SBOM. Dependencies required by the converter itself are retained.

Both Dockerfiles generate their scoped SBOM during the build from the lockfile
used by their isolated `npm ci` installation; they do not require generated SBOM
files in the checkout. Generation uses `--package-lock-only --offline` because
loading the actual monorepo root would incorrectly require sibling workspaces
that the image deliberately does not install. This is a lock-derived dependency
graph, not proof of physical file presence; verify installed packages and scan
the final image separately.
Pass `SOURCE_DATE_EPOCH` together with the existing source revision, source URL,
and version build arguments. The zero epoch default supports candidate builds;
release builds use the source commit timestamp. All-zero source revisions remain
forbidden unless candidate mode is explicitly enabled.

The Viewer serves its scoped document at `/legal/sbom.spdx.json`; the Converter
stores its scoped document at `/licenses/sbom.spdx.json`. The release workflow
extracts these documents from the immutable image digests before recording their
hashes, avoiding an assumption that different npm build environments produce
byte-identical documents. The source-wide SBOM is retained as separate evidence.

These documents cover npm production dependencies, not operating-system packages
or an exact list of JavaScript code retained by the bundler. Release acceptance
also requires an image inventory and vulnerability scan for the actual image
digest, plus browser bundle inspection. Build-tool vulnerabilities are assessed
separately; `--omit dev` must not be treated as an exemption for build risks.

The generator invokes the installed npm CLI with SPDX 2.3 output and
`--omit dev`, normalizes volatile metadata using the supplied release values,
and refuses mismatched source URL/revision pairs.

A release is not complete until:

- the SBOM is regenerated from a clean checkout;
- `npm run validate:publication` and the vulnerability scan pass;
- its SHA-256 is recorded beside the public source commit and image digest;
- each scoped SBOM hash matches the document extracted from its named image;
- the Viewer serves that same extracted document at `/legal/sbom.spdx.json`;
- both Viewer and Converter images identify the same public revision.
