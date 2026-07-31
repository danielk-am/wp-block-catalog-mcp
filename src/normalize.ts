import { createHash } from 'node:crypto';

import type { BlockDefinition, Relationship, SourceManifest } from './schema.js';
import { BlockDefinitionSchema } from './schema.js';

export interface NormalizeContext {
  source: SourceManifest;
  path: string;
  contentHash?: string;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function relationship(
  kind: Relationship['kind'],
  target: string,
  metadata: Record<string, unknown> = {},
): Relationship {
  return { kind, target, metadata };
}

export function extractRelationships(
  metadata: Record<string, unknown>,
): Relationship[] {
  const relationships: Relationship[] = [];

  for (const target of stringArray(metadata.parent)) {
    relationships.push(relationship('parent', target));
  }
  for (const target of stringArray(metadata.ancestor)) {
    relationships.push(relationship('ancestor', target));
  }
  for (const target of stringArray(metadata.allowedBlocks)) {
    relationships.push(relationship('allows_child', target));
  }

  const providesContext = metadata.providesContext;
  if (providesContext && typeof providesContext === 'object' && !Array.isArray(providesContext)) {
    for (const [ contextName, attribute ] of Object.entries(providesContext)) {
      relationships.push(
        relationship('provides_context', contextName, { attribute }),
      );
    }
  }
  for (const target of stringArray(metadata.usesContext)) {
    relationships.push(relationship('uses_context', target));
  }

  const blockHooks = metadata.blockHooks;
  if (blockHooks && typeof blockHooks === 'object' && !Array.isArray(blockHooks)) {
    for (const [ target, position ] of Object.entries(blockHooks)) {
      relationships.push(relationship('block_hook', target, { position }));
    }
  }

  return relationships;
}

export function normalizeBlockMetadata(
  metadata: Record<string, unknown>,
  context: NormalizeContext,
): BlockDefinition {
  if (typeof metadata.name !== 'string') {
    throw new Error(`Missing block name in ${context.path}`);
  }

  const contentHash =
    context.contentHash ??
    createHash('sha256').update(JSON.stringify(metadata)).digest('hex');

  const source = context.source;
  const definition: BlockDefinition = {
    id: `${source.id}:${metadata.name}`,
    sourceId: source.id,
    product: source.product,
    productVersion: source.productVersion,
    name: metadata.name,
    title: typeof metadata.title === 'string' ? metadata.title : null,
    description:
      typeof metadata.description === 'string' ? metadata.description : null,
    category: typeof metadata.category === 'string' ? metadata.category : null,
    apiVersion:
      typeof metadata.apiVersion === 'number' ? metadata.apiVersion : null,
    keywords: stringArray(metadata.keywords),
    attributes:
      metadata.attributes &&
      typeof metadata.attributes === 'object' &&
      !Array.isArray(metadata.attributes)
        ? metadata.attributes as Record<string, unknown>
        : {},
    supports:
      metadata.supports &&
      typeof metadata.supports === 'object' &&
      !Array.isArray(metadata.supports)
        ? metadata.supports as Record<string, unknown>
        : {},
    availability: {
      sourcePresent: true,
      includedInBuild: null,
      serverRegistered: null,
      clientRegistered: null,
      inserterVisible: null,
      editorSurfaces: [],
      experimental:
        typeof metadata.__experimental === 'boolean' ||
        typeof metadata.__experimental === 'string'
          ? metadata.__experimental
          : null,
      gates: [],
      state: 'unknown',
    },
    relationships: extractRelationships(metadata),
    variations: Array.isArray(metadata.variations)
      ? metadata.variations.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
      : [],
    rawMetadata: metadata,
    verification: [ 'metadata-only' ],
    visibility: source.visibility,
    provenance: {
      repository: source.repository,
      ref: source.ref,
      commit: source.commit,
      path: context.path,
      contentHash,
    },
  };

  return BlockDefinitionSchema.parse(definition);
}
