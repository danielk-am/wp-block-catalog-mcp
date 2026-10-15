# Alkamy 0.2.0 release readiness

Checked 15 October 2026. This release supports the four explicitly pinned public
environments in the README. It does not claim coverage of the newest upstream
versions or validation of a user's live site.

## Catalogue rebuild

All four upstream checkouts were fetched at their manifest commit SHAs. A real
source scan rebuilt 452 definitions: WordPress 109, Gutenberg 123, WooCommerce 174
and Jetpack 46. The source, environment and block arrays match the previous
release exactly. Only the catalogue version and genuine build timestamp changed.
Deterministic rebuild comparison and the current-time release gate pass, with
zero unexplained removals. The release freshness policy remains seven days.

All 34 tracked runtime files remain unchanged. Jetpack registry captures are
dated 30 July 2026; other registry capture dates and markup capture dates were
not recorded. Rebuilding source metadata does not refresh that runtime evidence.

The upstream tag check detected WordPress 7.1.3, Gutenberg 24.2.0, WooCommerce
11.2.1 and Jetpack 16.3.1 on the check date. Those versions are outside this
release's verified environments. A newer source tag alone is insufficient to
claim a matching PHP/editor runtime or grant markup verification labels.
The [tag-check report](source-check-2026-10-15.json) records exact observed refs.

## Automated and client checks

- `npm run verify` passed: 55 source tests, 17 maintenance tests, catalogue health
  and stdio MCP smoke. The 55 source tests also passed under Node.js 20.
- Release-clock tests use a fixed explicit clock, including stale evidence and
  removal-explanation cases. Production CLI checks still use the actual time.
- The scanner replacement was compared against all four real source checkouts.
  It preserved every selected block name, path and content hash. Duplicate
  patterns do not create duplicate entries.
- A live Codex CLI session loaded the companion skill and executed eight task
  cases through the real server. See the [demonstration](demo.md). Thirteen direct
  protocol checks cover the same evidence paths and error boundaries.
- Claude Code testing was omitted at the owner's request because paid access
  was unavailable. Other-client and Agensi delivery compatibility are untested.

## Dependencies and attribution

The MCP SDK is pinned to 1.32.1. tinyglobby 0.2.17 replaces fast-glob, removing the
vulnerable braces/micromatch production chain. Compatible transitive fixes are
locked. The runtime acquisition tool remains development-only; its version and
audit results are recorded below.

`npm audit --omit=dev` reports zero findings. The full audit reports nine
development-only findings: six moderate, one high and two critical. They are in
the optional acquisition stack, not the stdio MCP runtime dependency graph:

- `@wordpress/env` 11.17.0 includes `simple-git` and `@simple-git/argv-parser`
  advisories involving Git arguments/configuration and editor environment values.
  The application scanner uses Node's `execFile` with fixed Git argument arrays,
  not simple-git. MCP tools do not invoke wp-env or accept capture configurations.
- The Playground acquisition CLI carries an older Express/qs branch; its HTTP
  parsing findings do not describe the stdio server's transport. Other remaining
  findings are in the capture tooling's YAML/formatting argument dependencies.

The intermediate audit repair downgraded Playground and introduced vulnerable
ws/ajv versions. That candidate was rejected. The final capture stack uses
Playground/PHP-WASM 3.1.58 with the newer ws/ajv versions preserved.

Capture tooling remains limited to maintainer-controlled local configurations
and source repositories. Do not run it against untrusted acquisition inputs or
expose its servers to untrusted networks. These limitations do not make the
development advisories disappear; the full audit remains nonzero. Docker-based
capture must be revalidated and its dependencies re-audited before new runtime
evidence is acquired. The release's existing runtime bundles are unchanged.
The [audit record](dependency-audit-0.2.0.json) lists affected packages and advisory
URLs from the final lockfile check.

The MIT licence covers Alkamy's original software and documentation. Original
licence documents from the exact four upstream source revisions accompany the
release. Upstream provenance, product names and applicable terms remain intact.
Approved Alkamy logo files were reused from the canonical brand assets.

## Boundaries

No live WordPress site was modified. Docker-based runtime recapture was not
performed, and the updated acquisition tool was not exercised against Docker.
No npm package or Agensi listing was published as part of this release.
