# Security policy

Please report a suspected vulnerability through the repository's private
GitHub Security Advisory form. Do not publish credentials, customer data,
project files or exploit details in a public issue.

General defects that do not contain sensitive information may be reported as a
GitHub issue. Source-access questions may also be filed as a public issue and
must identify the release version or 40-character revision concerned.

## Converter operating boundary

The pinned Converter inherits the deprecated `request` chain through
`get-pixels` and `@loaders.gl/polyfills`. Fixed compatible releases of
`form-data`, `qs` and `tough-cookie` are enforced through root overrides. The
remaining npm findings are Moderate and have no upstream fix in the reviewed
Converter release.

Deploy the Converter with local input/output files only, no untrusted remote
URLs, a read-only root filesystem, a dedicated writable job directory and
network egress denied. CI blocks High or Critical production-dependency
findings. This disposition must be reviewed whenever the Converter pin changes.
