import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertReleaseReady,
  evaluateReleaseGates,
  summarizeReleaseDiff,
} from '../diff/index.js';
import type {
  BlockDefinition,
  CatalogArtifact,
  Environment,
  SourceManifest,
} from '../schema.js';
import { testArtifact } from './fixtures.js';

function changedRelease(): CatalogArtifact {
  const next = structuredClone(testArtifact());
  next.generatedAt = '2026-07-30T00:30:00.000Z';
  next.catalogVersion = 'test-2';
  next.blocks = next.blocks.filter(({ name }) => name !== 'core/heading');
  const paragraph = next.blocks.find(
    ({ sourceId }) => sourceId === 'gutenberg@2.0.0',
  );
  if (!paragraph) {
    throw new Error('Missing Gutenberg paragraph');
  }
  paragraph.title = 'Updated Gutenberg Paragraph';

  const template = next.blocks[0];
  if (!template) {
    throw new Error('Missing definition template');
  }
  next.blocks.push({
    ...structuredClone(template),
    id: 'wordpress@1.0.0:core/quote',
    name: 'core/quote',
    title: 'Quote',
    description: 'Quote description',
    rawMetadata: { name: 'core/quote', title: 'Quote', apiVersion: 3 },
    provenance: {
      ...template.provenance,
      path: 'blocks/quote/block.json',
      contentHash: 'c'.repeat(64),
    },
  });
  return next;
}

test('release diff reports deterministic additions, changes, and removals', () => {
  const summary = summarizeReleaseDiff(
    testArtifact(),
    changedRelease(),
    'public',
  );

  assert.deepEqual(summary.addedBlockNames, [ 'core/quote' ]);
  assert.deepEqual(summary.removedBlockNames, [ 'core/heading' ]);
  assert.deepEqual(
    summary.changedDefinitions,
    [ 'gutenberg@2.0.0:core/paragraph' ],
  );
  assert.deepEqual(
    summary.removedDefinitions,
    [ 'wordpress@1.0.0:core/heading' ],
  );
  assert.equal(summary.counts.blockNames.previous, 2);
  assert.equal(summary.counts.blockNames.next, 2);
});

test('release gate rejects unexplained removals', () => {
  const result = evaluateReleaseGates(
    testArtifact(),
    changedRelease(),
    {
      visibility: 'public',
      freshness: {
        maxAgeSeconds: 3600,
        maxFutureSkewSeconds: 60,
      },
    },
    new Date('2026-07-30T00:45:00.000Z'),
  );

  assert.equal(result.passed, false);
  assert.deepEqual(result.unexplainedRemovals, [
    { kind: 'block', key: 'core/heading' },
    { kind: 'definition', key: 'wordpress@1.0.0:core/heading' },
  ]);
  assert.throws(
    () => assertReleaseReady(
      testArtifact(),
      changedRelease(),
      {
        visibility: 'public',
        freshness: {
          maxAgeSeconds: 3600,
          maxFutureSkewSeconds: 60,
        },
      },
      new Date('2026-07-30T00:45:00.000Z'),
    ),
    /removal\(s\) lack an explanation/,
  );
});

test('one documented block removal covers its definitions', () => {
  const result = evaluateReleaseGates(
    testArtifact(),
    changedRelease(),
    {
      visibility: 'public',
      freshness: {
        maxAgeSeconds: 3600,
        maxFutureSkewSeconds: 60,
      },
      removalExplanations: [
        {
          kind: 'block',
          key: 'core/heading',
          reason: 'Removed after the supported deprecation period.',
        },
      ],
    },
    new Date('2026-07-30T00:45:00.000Z'),
  );

  assert.equal(result.passed, true);
  assert.deepEqual(result.unexplainedRemovals, []);
});

function privateOverlay(): {
  source: SourceManifest;
  environment: Environment;
  block: BlockDefinition;
} {
  const source: SourceManifest = {
    id: 'private-source@deploy',
    adapter: 'private-runtime',
    product: 'private-platform',
    productVersion: 'deploy',
    channel: 'deploy',
    visibility: 'private',
    repository: 'https://example.invalid/private-source',
    ref: 'deploy-1',
    commit: 'd'.repeat(40),
    include: [ 'private/catalogue/path/**' ],
    exclude: [],
    metadata: { selector: 'private-selector' },
  };
  const environment: Environment = {
    id: 'private-environment',
    title: 'Private environment',
    visibility: 'private',
    layers: [ { sourceId: source.id, priority: 100 } ],
    metadata: { gate: 'private-gate' },
  };
  const template = testArtifact().blocks[0]!;
  const block: BlockDefinition = {
    ...structuredClone(template),
    id: `${source.id}:private-vendor/example-block`,
    sourceId: source.id,
    product: source.product,
    productVersion: source.productVersion,
    name: 'private-vendor/example-block',
    title: 'Private Block Title',
    visibility: 'private',
    availability: {
      ...template.availability,
      gates: [ 'private-gate' ],
    },
    rawMetadata: {
      name: 'private-vendor/example-block',
      selector: 'private-selector',
    },
    provenance: {
      repository: source.repository,
      ref: source.ref,
      commit: source.commit,
      path: 'private/catalogue/path/block.json',
      contentHash: 'e'.repeat(64),
    },
  };
  return { source, environment, block };
}

test('public diff and gates cannot disclose private removals', () => {
  const previous = testArtifact();
  const overlay = privateOverlay();
  previous.sources.push(overlay.source);
  previous.environments.push(overlay.environment);
  previous.blocks.push(overlay.block);

  const next = structuredClone(previous);
  next.generatedAt = '2026-07-30T00:30:00.000Z';
  next.sources = next.sources.filter(({ visibility }) => visibility === 'public');
  next.environments = next.environments.filter(
    ({ visibility }) => visibility === 'public',
  );
  next.blocks = next.blocks.filter(({ visibility }) => visibility === 'public');

  const result = evaluateReleaseGates(
    previous,
    next,
    {
      visibility: 'public',
      freshness: {
        maxAgeSeconds: 3600,
        maxFutureSkewSeconds: 60,
      },
    },
    new Date('2026-07-30T00:45:00.000Z'),
  );
  const serialized = JSON.stringify(result);

  assert.equal(result.passed, true);
  assert.deepEqual(result.summary.removedSources, []);
  assert.deepEqual(result.summary.removedBlockNames, []);
  for (const secret of [
    'private-source@deploy',
    'private-vendor/example-block',
    'Private Block Title',
    'private/catalogue/path',
    'private-selector',
    'private-gate',
    'd'.repeat(40),
  ]) {
    assert.equal(serialized.includes(secret), false, `leaked ${secret}`);
  }
});

test('source-removal explanation covers definitions from that source', () => {
  const previous = testArtifact();
  const next = structuredClone(previous);
  next.generatedAt = '2026-07-30T00:30:00.000Z';
  next.sources = next.sources.filter(({ id }) => id !== 'gutenberg@2.0.0');
  next.blocks = next.blocks.filter(
    ({ sourceId }) => sourceId !== 'gutenberg@2.0.0',
  );
  for (const environment of next.environments) {
    environment.layers = environment.layers.filter(
      ({ sourceId }) => sourceId !== 'gutenberg@2.0.0',
    );
  }
  next.environments = next.environments.filter(
    ({ layers }) => layers.length > 0,
  );

  const result = evaluateReleaseGates(
    previous,
    next,
    {
      visibility: 'public',
      freshness: {
        maxAgeSeconds: 3600,
        maxFutureSkewSeconds: 60,
      },
      removalExplanations: [
        {
          kind: 'source',
          key: 'gutenberg@2.0.0',
          reason: 'The Gutenberg deployment source was retired intentionally.',
        },
      ],
    },
    new Date('2026-07-30T00:45:00.000Z'),
  );

  assert.equal(result.passed, true);
  assert.deepEqual(result.unexplainedRemovals, []);
});
