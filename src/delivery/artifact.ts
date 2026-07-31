import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  CatalogArtifactSchema,
  VisibilitySchema,
} from '../schema.js';
import type {
  BlockDefinition,
  CatalogArtifact,
  Environment,
  SourceManifest,
} from '../schema.js';

export const DeliveryVisibilitySchema = VisibilitySchema;
export type DeliveryVisibility = z.infer<typeof DeliveryVisibilitySchema>;

export class PublicArtifactLeakError extends Error {
  /**
   * Stable fingerprints for private values, suitable for diagnostics without
   * copying the values themselves into logs or API errors.
   */
  readonly leaks: string[];

  constructor(message: string, leaks: string[] = []) {
    super(message);
    this.name = 'PublicArtifactLeakError';
    this.leaks = leaks.map((leak) =>
      createHash('sha256').update(leak).digest('hex'));
  }
}

function sortStrings(values: string[]): string[] {
  return [ ...values ].sort((left, right) => left.localeCompare(right));
}

function canonicalSource(source: SourceManifest): SourceManifest {
  return {
    ...source,
    include: sortStrings(source.include),
    exclude: sortStrings(source.exclude),
    metadata: canonicalObject(source.metadata),
  };
}

function canonicalEnvironment(environment: Environment): Environment {
  return {
    ...environment,
    layers: [ ...environment.layers ].sort(
      (left, right) =>
        right.priority - left.priority ||
        left.sourceId.localeCompare(right.sourceId),
    ),
    metadata: canonicalObject(environment.metadata),
  };
}

function canonicalBlock(block: BlockDefinition): BlockDefinition {
  return {
    ...block,
    keywords: sortStrings(block.keywords),
    availability: {
      ...block.availability,
      editorSurfaces: sortStrings(block.availability.editorSurfaces),
      gates: sortStrings(block.availability.gates),
    },
    relationships: [ ...block.relationships ].sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.target.localeCompare(right.target) ||
        stableStringify(left.metadata).localeCompare(
          stableStringify(right.metadata),
        ),
    ),
    verification: [ ...block.verification ].sort(),
    attributes: canonicalObject(block.attributes),
    supports: canonicalObject(block.supports),
    rawMetadata: canonicalObject(block.rawMetadata),
  };
}

function canonicalObject(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input)
      .sort(([ left ], [ right ]) => left.localeCompare(right))
      .map(([ key, value ]) => [ key, canonicalValue(value) ]),
  );
}

function canonicalValue(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((value) => canonicalValue(value));
  }
  if (input && typeof input === 'object') {
    return canonicalObject(input as Record<string, unknown>);
  }
  return input;
}

/**
 * JSON serialization with recursively sorted object keys. Array order is
 * preserved because it can be semantically meaningful to block metadata.
 */
export function stableStringify(input: unknown): string {
  return JSON.stringify(canonicalValue(input));
}

/**
 * Canonicalizes collection order that is non-semantic in a catalogue
 * artefact. This is also the representation used for delivery hashes.
 */
export function canonicalizeArtifact(input: unknown): CatalogArtifact {
  const artifact = CatalogArtifactSchema.parse(input);
  return {
    ...artifact,
    sources: artifact.sources
      .map(canonicalSource)
      .sort((left, right) => left.id.localeCompare(right.id)),
    environments: artifact.environments
      .map(canonicalEnvironment)
      .sort((left, right) => left.id.localeCompare(right.id)),
    blocks: artifact.blocks
      .map(canonicalBlock)
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          left.sourceId.localeCompare(right.sourceId) ||
          left.id.localeCompare(right.id),
      ),
  };
}

function addStringValue(target: Set<string>, value: unknown): void {
  if (typeof value === 'string' && value.length > 0) {
    target.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      addStringValue(target, child);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) {
      addStringValue(target, child);
    }
  }
}

function addSensitiveMetadataStrings(
  target: Set<string>,
  value: unknown,
  sensitiveContext = false,
): void {
  if (typeof value === 'string') {
    if (sensitiveContext && value.length > 0) {
      target.add(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      addSensitiveMetadataStrings(target, child, sensitiveContext);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const [ key, child ] of Object.entries(value)) {
      addSensitiveMetadataStrings(
        target,
        child,
        sensitiveContext ||
          /(private|internal|secret|selector|gate|sticker|revision|commit|repository|path|source)/i.test(
            key,
          ),
      );
    }
  }
}

function publicStrings(artifact: CatalogArtifact): Set<string> {
  const values = new Set<string>();
  // A token that already exists independently in the public projection is
  // public knowledge, even if a private record happens to reuse it.
  addStringValue(values, artifact);
  return values;
}

function privateStrings(
  artifact: CatalogArtifact,
  publicIdentity: Set<string>,
): Set<string> {
  const values = new Set<string>();
  const privateSourceIds = new Set(
    artifact.sources
      .filter(({ visibility }) => visibility === 'private')
      .map(({ id }) => id),
  );

  for (const source of artifact.sources) {
    if (source.visibility === 'private') {
      addStringValue(values, {
        id: source.id,
        repository: source.repository,
        ref: source.ref,
        commit: source.commit,
        include: source.include,
        exclude: source.exclude,
        metadata: source.metadata,
      });
    }
  }
  for (const environment of artifact.environments) {
    if (
      environment.visibility === 'private' ||
      environment.layers.some(({ sourceId }) => privateSourceIds.has(sourceId))
    ) {
      addStringValue(values, {
        id: environment.id,
        title: environment.title,
        sourceIds: environment.layers.map(({ sourceId }) => sourceId),
        metadata: environment.metadata,
      });
    }
  }
  for (const block of artifact.blocks) {
    if (
      block.visibility === 'private' ||
      privateSourceIds.has(block.sourceId)
    ) {
      addStringValue(values, {
        id: block.id,
        sourceId: block.sourceId,
        name: block.name,
        title: block.title,
        gates: block.availability.gates,
        provenance: block.provenance,
        runtimeProvenance: block.runtimeProvenance,
      });
      addSensitiveMetadataStrings(values, block.rawMetadata);
    }
  }

  for (const value of publicIdentity) {
    values.delete(value);
  }
  // Runtime provenance is private by construction. Re-add it after removing
  // shared public values so an exact copied hash or deployment identity cannot
  // make itself look public.
  for (const block of artifact.blocks) {
    if (
      (block.visibility === 'private' ||
        privateSourceIds.has(block.sourceId)) &&
      block.runtimeProvenance
    ) {
      addStringValue(values, {
        environmentId: block.runtimeProvenance.environmentId,
        profileHash: block.runtimeProvenance.profileHash,
        serverRegistryHash:
          block.runtimeProvenance.serverRegistryHash,
        clientRegistryHash:
          block.runtimeProvenance.clientRegistryHash,
      });
    }
  }
  return values;
}

function findLeaks(serialized: string, sensitive: Set<string>): string[] {
  const leaks: string[] = [];
  for (const token of sensitive) {
    const exactJsonValue = JSON.stringify(token);
    const isGenericDate = /^\d{4}-\d{2}-\d{2}$/.test(token);
    if (
      serialized.includes(exactJsonValue) ||
      (!isGenericDate && token.length >= 8 && serialized.includes(token))
    ) {
      leaks.push(token);
    }
  }
  return leaks.sort((left, right) => left.localeCompare(right));
}

function sanitizePublicBlock(block: BlockDefinition): BlockDefinition {
  return {
    ...block,
    availability: {
      ...block.availability,
      // Gate identifiers and selector inputs belong in the private overlay.
      gates: [],
    },
  };
}

/**
 * Produces a delivery-safe artefact. Public delivery is deny-by-default:
 * private records are removed, mixed-visibility references are rejected, and
 * private identifiers are checked against the complete serialized output.
 */
export function prepareDeliveryArtifact(
  input: unknown,
  visibility: DeliveryVisibility,
): CatalogArtifact {
  const artifact = CatalogArtifactSchema.parse(input);
  if (visibility === 'private') {
    return canonicalizeArtifact(artifact);
  }

  const publicSources = artifact.sources
    .filter((source) => source.visibility === 'public')
    .map((source) => ({ ...source, metadata: {} }));
  const publicSourceIds = new Set(publicSources.map(({ id }) => id));

  const publicEnvironments = artifact.environments
    .filter((environment) => environment.visibility === 'public')
    .map((environment) => {
      const privateLayers = environment.layers.filter(
        ({ sourceId }) => !publicSourceIds.has(sourceId),
      );
      if (privateLayers.length > 0) {
        throw new PublicArtifactLeakError(
          'Public environment references a private or missing source',
          privateLayers.map(({ sourceId }) => sourceId),
        );
      }
      return { ...environment, metadata: {} };
    });

  const publicBlocks = artifact.blocks
    .filter((block) => {
      if (block.visibility === 'private') {
        return false;
      }
      if (!publicSourceIds.has(block.sourceId)) {
        throw new PublicArtifactLeakError(
          'Public block references a private or missing source',
          [ block.sourceId ],
        );
      }
      return true;
    })
    .map(sanitizePublicBlock);

  const publicArtifact = canonicalizeArtifact({
    ...artifact,
    sources: publicSources,
    environments: publicEnvironments,
    blocks: publicBlocks,
  });
  const publicKnownValues = publicStrings(publicArtifact);
  const sensitive = privateStrings(artifact, publicKnownValues);
  const leaks = findLeaks(JSON.stringify(publicArtifact), sensitive);
  if (leaks.length > 0) {
    throw new PublicArtifactLeakError(
      'Public artefact contains private catalogue data',
      leaks,
    );
  }

  return publicArtifact;
}

/**
 * Computes a content hash, excluding generatedAt so byte-identical catalogue
 * content rebuilt at a later time retains the same release identity.
 */
export function hashArtifact(input: unknown): string {
  const artifact = canonicalizeArtifact(input);
  const { generatedAt: _generatedAt, ...content } = artifact;
  return createHash('sha256')
    .update(stableStringify(content))
    .digest('hex');
}
