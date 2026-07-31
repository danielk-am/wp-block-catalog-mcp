import { createHash } from 'node:crypto';

import type {
  BlockDefinition,
  CatalogArtifact,
  SourceManifest,
} from '../schema.js';

const coreCommit = '1'.repeat(40);
const gutenbergCommit = '2'.repeat(40);
const privateCommit = '3'.repeat(40);

export const coreSource: SourceManifest = {
  id: 'wordpress@1.0.0',
  adapter: 'wordpress-core',
  product: 'wordpress',
  productVersion: '1.0.0',
  channel: 'stable',
  visibility: 'public',
  repository: 'https://github.com/WordPress/wordpress-develop',
  ref: '1.0.0',
  commit: coreCommit,
  include: [ 'src/wp-includes/blocks/**/block.json' ],
  exclude: [],
  metadata: {},
};

export const gutenbergSource: SourceManifest = {
  id: 'gutenberg@2.0.0',
  adapter: 'gutenberg-plugin',
  product: 'gutenberg',
  productVersion: '2.0.0',
  channel: 'stable',
  visibility: 'public',
  repository: 'https://github.com/WordPress/gutenberg',
  ref: 'v2.0.0',
  commit: gutenbergCommit,
  include: [ 'packages/block-library/src/**/block.json' ],
  exclude: [],
  metadata: {},
};

export const privateSource: SourceManifest = {
  id: 'private-platform@deploy',
  adapter: 'private-platform-deploy',
  product: 'private-platform',
  productVersion: 'deploy',
  channel: 'deploy',
  visibility: 'private',
  repository: 'https://example.invalid/private-source',
  ref: 'deploy-1',
  commit: privateCommit,
  include: [ 'private/blocks/**/block.json' ],
  exclude: [],
  metadata: {},
};

function definition(
  source: SourceManifest,
  name: string,
  title: string,
): BlockDefinition {
  const rawMetadata = { name, title, apiVersion: 3 };
  return {
    id: `${source.id}:${name}`,
    sourceId: source.id,
    product: source.product,
    productVersion: source.productVersion,
    name,
    title,
    description: `${title} description`,
    category: 'text',
    apiVersion: 3,
    keywords: [],
    attributes: {},
    supports: {},
    availability: {
      sourcePresent: true,
      includedInBuild: null,
      serverRegistered: null,
      clientRegistered: null,
      inserterVisible: null,
      editorSurfaces: [],
      experimental: null,
      gates: [],
      state: 'unknown',
    },
    relationships: [],
    variations: [],
    rawMetadata,
    verification: [ 'metadata-only' ],
    visibility: source.visibility,
    provenance: {
      repository: source.repository,
      ref: source.ref,
      commit: source.commit,
      path: `blocks/${name.split('/')[1]}/block.json`,
      contentHash: createHash('sha256')
        .update(JSON.stringify(rawMetadata))
        .digest('hex'),
    },
  };
}

export function testArtifact(): CatalogArtifact {
  return {
    schemaVersion: 1,
    catalogVersion: 'test-1',
    generatedAt: '2026-07-30T00:00:00.000Z',
    sources: [ coreSource, gutenbergSource ],
    environments: [
      {
        id: 'wordpress-only',
        title: 'WordPress only',
        visibility: 'public',
        layers: [ { sourceId: coreSource.id, priority: 10 } ],
        metadata: {},
      },
      {
        id: 'wordpress-with-gutenberg',
        title: 'WordPress with Gutenberg',
        visibility: 'public',
        layers: [
          { sourceId: coreSource.id, priority: 10 },
          { sourceId: gutenbergSource.id, priority: 20 },
        ],
        metadata: {},
      },
    ],
    blocks: [
      definition(coreSource, 'core/paragraph', 'Core Paragraph'),
      definition(gutenbergSource, 'core/paragraph', 'Gutenberg Paragraph'),
      definition(coreSource, 'core/heading', 'Heading'),
    ],
  };
}

export function privateRuntimeArtifact(): CatalogArtifact {
  const artifact = testArtifact();
  artifact.sources.push(privateSource);
  artifact.environments.push({
    id: 'private-platform@deploy:eligible',
    title: 'Private platform eligible profile',
    visibility: 'private',
    layers: [ { sourceId: privateSource.id, priority: 100 } ],
    metadata: { profile: 'eligible' },
  });
  artifact.blocks.push(
    definition(
      privateSource,
      'example/source-backed',
      'Source-backed private fixture',
    ),
  );
  return artifact;
}
