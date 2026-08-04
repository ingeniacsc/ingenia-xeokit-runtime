# INGENIA xeokit Converter

This workspace is the complete INGENIA-authored source for the neutral
Converter boundary. It starts the exact upstream `@xeokit/xeokit-convert@1.3.2`
CLI in a separate process and exchanges only command-line arguments and files.

The runtime applies one reviewed compatibility patch to
`@loaders.gl/polyfills@4.3.4`: missing `.js` suffixes are added to six ESM
import strings across five files. The patch is deterministic, idempotent and
fail-closed when the pinned dependency no longer matches the reviewed layout.

Reproduce the executable environment with:

```sh
npm ci --ignore-scripts
npm run converter:prepare
npm run converter:version
docker build -f docker/Converter.Dockerfile .
```

No INGENIA backend, authorization, customer, project or workflow logic is part
of this program.
