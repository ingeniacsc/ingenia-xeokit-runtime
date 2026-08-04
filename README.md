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
npm test
npm run build
```

The converter is pinned to `@xeokit/xeokit-convert@1.3.2`. Run it through the
neutral wrapper after preparing the reviewed compatibility patch:

```sh
npm run converter:prepare
node packages/converter/bin/ingenia-xeokit-convert.mjs --help
```

Set `VITE_ALLOWED_PARENT_ORIGINS` to an explicit comma-separated origin list.
The viewport refuses to start when the parent origin, session, or nonce is not
valid. Use only synthetic or independently licensed public XKT fixtures.

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
