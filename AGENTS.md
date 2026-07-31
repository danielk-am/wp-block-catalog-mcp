# wp-block-catalog

This repository builds and serves a version-aware catalogue of WordPress block definitions.

## Rules

- Source manifests must pin an immutable commit SHA. A branch name alone is not provenance.
- Hosted catalogue builds may ingest only allowlisted repositories and paths.
- Preserve raw `block.json` metadata alongside normalized fields.
- Never resolve duplicate block names by scan order or timestamp. Resolve through an explicit environment layer.
- Do not label markup `verified` unless the matching WordPress runtime executed its registration and save or render path.
- Public catalogue artefacts must not contain non-public repository paths or definitions.

## Verification

Run before handoff:

```bash
npm run verify
npm audit --omit=dev
```
