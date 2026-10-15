# Recorded Codex demonstration

Recorded 15 October 2026 with Codex CLI 0.162.0-alpha.17.2, the project-scoped
companion skill and the running local MCP server. This is an excerpt from an
executed client session, not an illustration of a hypothetical result.

## 1. Select the environment

The agent called `list_environments`, selected `wordpress@7.0.2` and inspected
`core/paragraph`. It kept the source schema, runtime registration and markup
evidence separate.

## 2. Retrieve and check recorded markup

The agent called `generate_markup` with:

```json
{"environment":"wordpress@7.0.2","name":"core/paragraph","attributes":{"content":"Hello catalogue"}}
```

The server returned `verified: true`, evidence kind `static-save`, label
`save-runtime-valid`, and these markup bytes:

```html
<!-- wp:paragraph -->
<p>Hello catalogue</p>
<!-- /wp:paragraph -->
```

The agent passed the unchanged bytes to `validate_markup`, which returned
`verified: true`.

## 3. Keep missing evidence explicit

The same generation request with content `Different content` returned
`verified: false` and no markup. The agent did not substitute the known fixture.
After changing the known markup to that text, validation also returned false.
The agent's recorded conclusion was that these bytes have no stored passed
evidence; the lookup does not prove WordPress would reject them.

The run also checked dynamic WooCommerce output, the disconnected Jetpack
profile, a cross-environment comparison and an unsupported environment.

Read the [complete acceptance answer](codex-acceptance.md) or the
[recorded MCP requests and responses](demo-recording.json).

Catalogue: `2026-10-15-alkamy-pinned`. Its source build is dated 15 October 2026.
The runtime evidence remains historical: Jetpack registry captures are dated
30 July; the other registry capture dates and markup capture dates are absent.
No fresh WordPress save or render execution took place in this client session.

Only Codex was exercised. Claude Code, Cursor, Copilot and Agensi connector
delivery remain untested.
