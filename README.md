# WordPress Block Catalogue MCP

Give agents and developer tools verified WordPress block definitions and
markup for the exact public product environment they target.

WordPress Block Catalogue MCP is a read-only Model Context Protocol server for
finding, comparing, generating, and validating blocks shipped by WordPress,
Gutenberg, WooCommerce, and Jetpack. It keeps source metadata, PHP
registration, editor registration, and runtime verification as separate
observations so clients do not have to guess from source files.

## Capabilities

- Resolve block definitions through explicit product and version layers.
- Search blocks and inspect attributes, supports, relationships, variations,
  availability, and provenance.
- Compare one block across environments.
- Generate or validate markup at the strongest verified evidence level.
- Report drift between source metadata, the PHP registry, and the editor
  registry.
- Reject non-public sources and provenance from the public delivery artefact.

## Requirements

- Node.js 20 or newer
- npm

The package is not published to npm. Clone the repository and run it from the
working tree.

## Quick start

```bash
git clone https://github.com/danielk-am/wp-block-catalog.git
cd wp-block-catalog
npm ci
npm run verify
```

Start the stdio MCP server with the committed public catalogue and runtime
evidence:

```bash
WP_BLOCK_CATALOG_PATH="$PWD/catalog/public.release.generated.json" \
WP_BLOCK_DEFAULT_ENVIRONMENT="wordpress@7.0.2" \
WP_BLOCK_RUNTIME_PATHS="$PWD/runtime/wordpress-7.0.2-post-editor.reconciled.json:$PWD/runtime/wordpress-7.0.2-gutenberg-23.6.2-post-editor.reconciled.json:$PWD/runtime/wordpress-7.0.2-woocommerce-10.9.4-post-editor.reconciled.json:$PWD/runtime/wordpress-7.0.2-jetpack-16.0.1-disconnected-post-editor.reconciled.json" \
WP_BLOCK_VERIFICATION_PATHS="$PWD/runtime/wordpress-7.0.2.verified-markup.json:$PWD/runtime/wordpress-7.0.2-gutenberg-23.6.2.verified-markup.json:$PWD/runtime/wordpress-7.0.2-woocommerce-10.9.4.verified-markup.json:$PWD/runtime/wordpress-7.0.2-jetpack-16.0.1-disconnected.verified-markup.json" \
npm start
```

For an MCP client, use absolute paths:

```json
{
  "mcpServers": {
    "wordpress-block-catalogue": {
      "command": "node",
      "args": ["/absolute/path/wp-block-catalog/dist/mcp/server.js"],
      "env": {
        "WP_BLOCK_CATALOG_PATH": "/absolute/path/wp-block-catalog/catalog/public.release.generated.json",
        "WP_BLOCK_DEFAULT_ENVIRONMENT": "wordpress@7.0.2",
        "WP_BLOCK_RUNTIME_PATHS": "/absolute/path/wp-block-catalog/runtime/wordpress-7.0.2-post-editor.reconciled.json:/absolute/path/wp-block-catalog/runtime/wordpress-7.0.2-gutenberg-23.6.2-post-editor.reconciled.json:/absolute/path/wp-block-catalog/runtime/wordpress-7.0.2-woocommerce-10.9.4-post-editor.reconciled.json:/absolute/path/wp-block-catalog/runtime/wordpress-7.0.2-jetpack-16.0.1-disconnected-post-editor.reconciled.json",
        "WP_BLOCK_VERIFICATION_PATHS": "/absolute/path/wp-block-catalog/runtime/wordpress-7.0.2.verified-markup.json:/absolute/path/wp-block-catalog/runtime/wordpress-7.0.2-gutenberg-23.6.2.verified-markup.json:/absolute/path/wp-block-catalog/runtime/wordpress-7.0.2-woocommerce-10.9.4.verified-markup.json:/absolute/path/wp-block-catalog/runtime/wordpress-7.0.2-jetpack-16.0.1-disconnected.verified-markup.json"
      }
    }
  }
}
```

`*_PATHS` uses the operating system path delimiter, `:` on macOS and Linux or
`;` on Windows. Singular `*_PATH` and plural `*_PATHS` settings can be
combined. Duplicate environment bundles or verification record identities
stop the server at startup.

## Supported environments

| Environment | Server registry | Client registry | Verified evidence |
| --- | ---: | ---: | --- |
| WordPress 7.0.2 | 110 blocks | 109 blocks | Static, deprecated, and dynamic |
| WordPress 7.0.2 with Gutenberg 23.6.2 | 160 blocks | 116 blocks | Static, deprecated, and dynamic |
| WordPress 7.0.2 with WooCommerce 10.9.4 | 285 blocks | 264 blocks | Dynamic |
| WordPress 7.0.2 with Jetpack 16.0.1, disconnected | 110 blocks | 109 blocks | Core static smoke |

See [runtime captures](docs/runtime-captures.md) for capture details and the
[catalogue audit](docs/catalogue-audit.md) for product-specific acceptance
cases.

## MCP tools and resources

Primary tools:

- `list_environments`
- `search_blocks`
- `get_block`
- `compare_block_versions`
- `generate_markup`
- `validate_markup`
- `get_verification_evidence`
- `get_runtime_drift`

Compatibility aliases:

- `get_block_schema`
- `get_block_markup`
- `list_block_attributes`
- `search_variations`

Resources:

- `wp-block-catalog://manifest`
- `wp-block-catalog://blocks/{environment}/{name}`

## Evidence model

The catalogue retains three observations independently:

1. metadata from an allowlisted path at a pinned source commit;
2. the final PHP block registry from the matching product environment;
3. the client block registry from the real editor.

Static markup is verified by running the registered save implementation,
parsing its output, and running WordPress validation. Deprecated markup is
verified through fixture matching, migration, current save, parsing, and
validation. Dynamic markup is verified through the registered PHP render
callback.

The
[architecture decision](docs/decisions/0001-hybrid-source-and-runtime-catalogue.md)
explains why disagreements remain visible.

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

Read [AGENTS.md](AGENTS.md) before changing source manifests, resolution rules,
or verification labels.

## Status

Version 0.1.4 is the initial public-only repository snapshot. It includes four
public environments and a committed deterministic release artefact.

## License

No open-source license has been granted yet. Public visibility does not grant
permission to copy, modify, or redistribute the code.
