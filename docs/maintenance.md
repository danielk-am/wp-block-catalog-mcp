# Maintain the catalogue

## Rebuilding the catalogue

Place exact source checkouts under `.checkouts/` as declared in
`build/public.json`, then run:

```bash
npm run catalog:build
npm run catalog:health
```

The build stops when a checkout differs from its manifest commit. Product
adapters scan only declared include paths and never select duplicate
definitions by scan order.

Check the four supported public stable channels:

```bash
npm run check:sources
```

The command exits `0` when every pin is current, `10` when a supported update
exists, and `20` when the check is indeterminate. It never falls back to a
branch head.

Verify a release candidate against a saved previous public release:

```bash
npm run catalog:release -- /path/to/previous-public.json
```

This command rebuilds from the exact checkouts, compares the result with the
committed delivery artefact, checks freshness, and rejects unexplained
removals.

## Capturing the Jetpack profile

Install Chromium once:

```bash
npx playwright install chromium
```

Capture the disconnected Jetpack environment through a local `wp-env`
instance:

```bash
WP_BLOCK_CATALOG_ADMIN_USER="<local-wp-env-admin>" \
WP_BLOCK_CATALOG_ADMIN_PASSWORD="<local-wp-env-password>" \
npm run capture:jetpack -- \
  --config .wp-env.jetpack.json \
  --profile profiles/wordpress-7.0.2-jetpack-16.0.1-disconnected-post-editor.json \
  --environment environments/wordpress-7.0.2-jetpack-16.0.1.json \
  --output-dir /tmp/wp-block-catalog-jetpack-capture
```

The wrapper validates the public disconnected profile, captures the PHP and
editor registries plus a Paragraph save-and-validate probe, destroys the
isolated environment, then publishes the raw evidence.

## Public data boundary

This repository contains only public source manifests, public runtime
evidence, and the public delivery artefact. The delivery layer rejects
non-public sources, definitions, environments, paths, revisions, provenance,
and gate details.

Do not add private source checkouts, captures, catalogues, logs, or credentials
to this repository. Use synthetic fixtures when testing the privacy boundary.

## Development

Run the complete local gate:

```bash
npm ci
npm run verify
npm audit --omit=dev
git diff --check
```

Read [AGENTS.md](../AGENTS.md) before changing source manifests, resolution rules,
or verification labels.


[Back to the README](../README.md)
