# ADR 0001: Combine source metadata with runtime registries

## Status

Accepted

## Context

`block.json` is the canonical shared registration surface, but it does not contain every client registration behavior. The WordPress REST block-types endpoint reports only server-registered blocks. Client registration supplies additional transforms, variations, deprecations, and save implementations. Products can also ship several definitions of the same block name, with the active definition determined by the runtime environment.

## Decision

The catalogue will merge three independently retained observations:

1. source metadata from a pinned product release;
2. the PHP/server block registry from that product environment;
3. the client block registry from that product environment.

The merge records disagreements. It does not silently prefer one source.

Every query resolves through an explicit environment whose layers define product precedence. Scan order, index time, and branch freshness never select a block definition.

## Consequences

- Source-only records can be discovered but remain `metadata-only`.
- Static markup becomes `save-runtime-valid` only after executing the matching client runtime.
- Dynamic markup becomes `server-render-valid` only after executing the matching server runtime.
- Catalogue builds need reproducible product environments in addition to source checkouts.
- Non-public product data requires a separate repository, artefact, and
  deployment-profile identity. It must never enter this public repository.
