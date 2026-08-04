# Corresponding Source

The INGENIA xeokit Runtime is offered under GNU AGPL version 3 only. The offer
covers both the isolated Viewer and the separately executed Converter. Every
deployed Viewer must display a direct link to the exact public source commit
used to build it, and every distributed Converter image must carry the same
source URL and revision as OCI labels.

The running image exposes:

- `/source.json`: source URL, revision and version;
- `/legal/LICENSE`: complete license and preserved xeokit notices;
- `/legal/NOTICE`: INGENIA notice;
- `/legal/THIRD_PARTY_NOTICES`: dependency notices;
- `/legal/sbom.spdx.json`: machine-readable dependency inventory.

The source URL must identify a public, no-charge network location that contains
all source needed to build the deployed Viewer and Converter: the neutral
wrapper, exact dependency pin and lockfile, INGENIA installation patch, build
files, license, notices and SBOM. A branch root, upstream-only link or private
monorepo URL is not sufficient release evidence.

This candidate document does not activate a public source offer by itself.
Activation requires the named legal approval, a real public commit, a clean
release build and recorded source/SBOM/image hashes.
