# INGENIA xeokit Runtime

This directory is a clean-history public-repository candidate for the isolated
BIM viewport and standalone IFC-to-XKT converter. It contains graphics and
neutral conversion concerns only: model loading, camera, selection, visibility,
appearance, spatial clipping, snapshots, a bounded `postMessage` bridge, and a
CLI/file converter wrapper.

It contains no INGENIA user, project, organization, permission, CDE, AppInG,
Schedule, backend, token, cookie, or customer model data. Business decisions
remain in the private parent application.

## Development

```sh
npm ci
npm run converter:prepare
npm run converter:smoke
npm test
npm run build
```

The converter is pinned to `@xeokit/xeokit-convert@1.3.2`. Run it through the
neutral wrapper after preparing the reviewed compatibility patch:

```sh
npm run converter:prepare
node packages/converter/bin/ingenia-xeokit-convert.mjs --help
```

The release Viewer is compiled with the reviewed first-party parent allowlist
`https://ingenia.vn,https://staging.ingenia.vn`. This lets one immutable image
digest pass staging canary and then be promoted to production without rebuild
drift. Runtime CSP remains a separate, narrower control: set
`XEOKIT_FRAME_ANCESTORS` and `XEOKIT_CONNECT_SRC` to only the active
environment origin. The viewport refuses to start when the parent origin,
session, or nonce is not valid. Use only synthetic or independently licensed
public fixtures.

Before a release tag, manually dispatch the release preflight workflow. It
publishes clearly labelled preflight images, creates registry provenance,
pulls both images by digest, runs the real IFC-to-XKT smoke through the
Converter image, and verifies the Viewer at the staging parent origin. It does
not deploy or create a release tag. The verifier logs out of GHCR before it
pulls the images, so the preflight also fails until both container packages are
actually public. A passing preflight is required evidence, not authorization
to release.

## Publication gate

The root includes the complete AGPLv3 text copied from the exact pinned xeokit
dependency. The Viewer exposes an in-product Corresponding Source link and the
container carries source, revision, version and license OCI labels.

Publication remains fail-closed. A release operator must:

1. use a clean checkout of the public repository;
2. provide a real 40-character public commit through `RELEASE_REVISION`;
3. set `RELEASE_SOURCE_URL` to that exact public commit;
4. generate `sbom.spdx.json` with a fixed `SOURCE_DATE_EPOCH`;
5. run `npm test`, `npm run validate:publication` and `npm run build`;
6. build and verify the image using the same source metadata;
7. bind the source commit, SBOM hash and image digest in release evidence;
8. verify both Viewer and Converter images against the same source metadata;
9. obtain the named legal and security approvals.

See `SOURCE_OFFER.md` and `SBOM.md`. This candidate is not a public release
until those gates are complete.
