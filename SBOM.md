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

The generator invokes the installed npm CLI with SPDX 2.3 output and
`--omit dev`, normalizes volatile metadata using the supplied release values,
and refuses mismatched source URL/revision pairs.

A release is not complete until:

- the SBOM is regenerated from a clean checkout;
- `npm run validate:publication` and the vulnerability scan pass;
- its SHA-256 is recorded beside the public source commit and image digest;
- the served image exposes the same SBOM at `/legal/sbom.spdx.json`.
- both Viewer and Converter images identify the same public revision.
