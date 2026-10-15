# Changelog

## Unreleased

## 0.2.0 - 2026-10-15

- Maintain WP Block Catalog MCP under Alkamy with the package name
  `@alkamy/wp-block-catalog-mcp`.
- License Alkamy's code and documentation under MIT and identify the separate
  terms for upstream-derived material.
- Add the portable companion skill, approved Alkamy logo assets and a recorded
  Codex demonstration.
- Rebuild the 452-definition public catalogue from the same four immutable
  source commits. Preserve runtime evidence and its original or unknown dates.
- Upgrade the MCP SDK and compatible transitive dependencies; replace fast-glob
  with tinyglobby to remove the vulnerable brace-parser dependency chain.
- Make release-gate tests use an explicit clock while production releases retain
  the actual-time freshness check, including a stale-snapshot regression case.
- Align the MCP server's advertised version with the package version.

## 0.1.4 - 2026-07-31

- Publish the first public-only repository snapshot with no inherited private
  history, tags, releases, source manifests, runtime captures, or catalogue
  artefacts.
- Include pinned WordPress 7.0.2, Gutenberg 23.6.2, WooCommerce 10.9.4, and
  Jetpack 16.0.1 source packs.
- Include four public runtime profiles and evidence-backed static, deprecated,
  and dynamic markup examples.
- Add deterministic source drift, exact-checkout rebuild, release, health,
  production dependency, and MCP smoke gates.
- Keep privacy-boundary tests synthetic and reject non-public provenance from
  the public delivery artefact.
