import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PublicArtifactLeakError,
  assertArtifactFresh,
  checkArtifactFreshness,
  hashArtifact,
  prepareDeliveryArtifact,
} from '../delivery/index.js';
import type {
  BlockDefinition,
  CatalogArtifact,
  Environment,
  SourceManifest,
} from '../schema.js';
import { testArtifact } from './fixtures.js';

const privateCommit = 'a'.repeat(40);
const privateProfileHash = 'c'.repeat(64);
const privateServerRegistryHash = 'd'.repeat(64);
const privateClientRegistryHash = 'e'.repeat(64);

function privateSource(): SourceManifest {
  return {
    id: 'private-platform@1',
    adapter: 'private-runtime',
    product: 'private-platform',
    productVersion: '1',
    channel: 'deploy',
    visibility: 'private',
    repository: 'https://example.invalid/private-source',
    ref: 'deploy-private',
    commit: privateCommit,
    include: [ 'private/blocks/example/**' ],
    exclude: [ 'private/blocks/example/tests/**' ],
    metadata: {
      selector: 'private-deployment-selector',
      gate: 'private-blog-sticker',
    },
  };
}

function privateBlock(source: SourceManifest): BlockDefinition {
  return {
    id: `${source.id}:private-vendor/example-block`,
    sourceId: source.id,
    product: source.product,
    productVersion: source.productVersion,
    name: 'private-vendor/example-block',
    title: 'Confidential Block Name',
    description: 'An internal block',
    category: 'internal',
    apiVersion: 3,
    keywords: [ 'private' ],
    attributes: {},
    supports: {},
    availability: {
      sourcePresent: true,
      includedInBuild: true,
      serverRegistered: true,
      clientRegistered: true,
      inserterVisible: false,
      editorSurfaces: [ 'internal-editor' ],
      experimental: false,
      gates: [ 'private-blog-sticker' ],
      state: 'gated',
    },
    relationships: [],
    variations: [],
    rawMetadata: {
      name: 'private-vendor/example-block',
      internalSelector: 'private-deployment-selector',
    },
    verification: [ 'save-runtime-valid' ],
    visibility: 'private',
    provenance: {
      repository: source.repository,
      ref: source.ref,
      commit: source.commit,
      path: 'private/blocks/example/block.json',
      contentHash: 'b'.repeat(64),
    },
    runtimeProvenance: {
      kind: 'deployment-registry',
      environmentId: 'private-platform-production',
      observation: {
        serverCapturedAt: '2026-07-30T00:00:00.000Z',
        clientCapturedAt: '2026-07-30T00:00:00.000Z',
      },
      profileHash: privateProfileHash,
      serverRegistryHash: privateServerRegistryHash,
      clientRegistryHash: privateClientRegistryHash,
      origins: [ 'server', 'client' ],
    },
  };
}

function privateEnvironment(source: SourceManifest): Environment {
  return {
    id: 'private-platform-production',
    title: 'Confidential production selector',
    visibility: 'private',
    layers: [ { sourceId: source.id, priority: 100 } ],
    metadata: {
      selector: 'sun',
      gate: 'private-blog-sticker',
      revision: privateCommit,
    },
  };
}

function artifactWithPrivateOverlay(): CatalogArtifact {
  const artifact = structuredClone(testArtifact());
  const source = privateSource();
  artifact.sources.push(source);
  artifact.environments.push(privateEnvironment(source));
  artifact.blocks.push(privateBlock(source));
  return artifact;
}

test('public delivery strips the complete private overlay and gate metadata', () => {
  const input = artifactWithPrivateOverlay();
  input.sources[0]!.metadata = {
    deploymentSelector: 'public-but-sensitive-selector',
  };
  input.environments[0]!.metadata = {
    blogGate: 'public-but-sensitive-gate',
  };
  input.blocks[0]!.availability.gates = [
    'public-but-sensitive-block-gate',
  ];

  const delivered = prepareDeliveryArtifact(input, 'public');
  const serialized = JSON.stringify(delivered);

  assert.ok(delivered.sources.every(({ visibility }) => visibility === 'public'));
  assert.ok(delivered.blocks.every(({ visibility }) => visibility === 'public'));
  assert.ok(
    delivered.environments.every(
      ({ visibility }) => visibility === 'public',
    ),
  );
  assert.ok(delivered.sources.every(({ metadata }) =>
    Object.keys(metadata).length === 0));
  assert.ok(delivered.environments.every(({ metadata }) =>
    Object.keys(metadata).length === 0));
  assert.ok(delivered.blocks.every(({ availability }) =>
    availability.gates.length === 0));

  for (const secret of [
    'private-platform@1',
    'private-vendor/example-block',
    'Confidential Block Name',
    'private/blocks/example/block.json',
    'private-deployment-selector',
    'private-blog-sticker',
    privateCommit,
    privateProfileHash,
    privateServerRegistryHash,
    privateClientRegistryHash,
    'public-but-sensitive-selector',
    'public-but-sensitive-gate',
    'public-but-sensitive-block-gate',
  ]) {
    assert.equal(serialized.includes(secret), false, `leaked ${secret}`);
  }
});

test('public delivery rejects private source references disguised as public', () => {
  const input = artifactWithPrivateOverlay();
  const privateDefinition = input.blocks.at(-1);
  if (!privateDefinition) {
    throw new Error('Missing private definition');
  }
  privateDefinition.visibility = 'public';

  assert.throws(
    () => prepareDeliveryArtifact(input, 'public'),
    (error) =>
      error instanceof PublicArtifactLeakError &&
      error.leaks.length === 1 &&
      !JSON.stringify(error).includes('private-platform@1'),
  );
});

test('public delivery detects private values copied into nested public metadata', () => {
  const input = artifactWithPrivateOverlay();
  input.blocks[0]!.rawMetadata = {
    ...input.blocks[0]!.rawMetadata,
    innocentLooking: {
      documentation:
        'See private/blocks/example/block.json internally ' +
        `for runtime profile ${privateProfileHash}`,
    },
  };

  assert.throws(
    () => prepareDeliveryArtifact(input, 'public'),
    (error) =>
      error instanceof PublicArtifactLeakError &&
      error.leaks.length > 0 &&
      !JSON.stringify(error).includes(
        'private/blocks/example',
      ),
  );
});

test('public delivery rejects copied private runtime provenance', () => {
  const input = artifactWithPrivateOverlay();
  input.blocks[0]!.runtimeProvenance =
    input.blocks.at(-1)?.runtimeProvenance;

  assert.throws(
    () => prepareDeliveryArtifact(input, 'public'),
    (error) =>
      error instanceof PublicArtifactLeakError &&
      error.leaks.length > 0 &&
      !JSON.stringify(error).includes(privateProfileHash),
  );
});

test('artefact hash is stable across rebuild time and non-semantic ordering', () => {
  const left = testArtifact();
  const right = structuredClone(left);
  right.generatedAt = '2026-08-01T00:00:00.000Z';
  right.sources.reverse();
  right.environments.reverse();
  right.blocks.reverse();
  for (const environment of right.environments) {
    environment.layers.reverse();
  }

  assert.equal(hashArtifact(left), hashArtifact(right));

  right.blocks[0]!.title = 'Changed';
  assert.notEqual(hashArtifact(left), hashArtifact(right));
});

test('freshness policy rejects stale and future-dated artefacts', () => {
  const artifact = testArtifact();
  const policy = {
    maxAgeSeconds: 3600,
    maxFutureSkewSeconds: 60,
  };

  assert.equal(
    checkArtifactFreshness(
      artifact,
      policy,
      new Date('2026-07-30T00:30:00.000Z'),
    ).status,
    'fresh',
  );
  assert.equal(
    checkArtifactFreshness(
      artifact,
      policy,
      new Date('2026-07-30T02:00:00.000Z'),
    ).status,
    'stale',
  );
  assert.equal(
    checkArtifactFreshness(
      artifact,
      policy,
      new Date('2026-07-29T23:00:00.000Z'),
    ).status,
    'future',
  );
  assert.throws(
    () => assertArtifactFresh(
      artifact,
      policy,
      new Date('2026-07-30T02:00:00.000Z'),
    ),
    /freshness gate failed: stale/,
  );
});

test('health freshness disables stale age without allowing future dates', () => {
  const artifact = testArtifact();
  const policy = {
    maxAgeSeconds: null,
    maxFutureSkewSeconds: 60,
  };

  const oldResult = checkArtifactFreshness(
    artifact,
    policy,
    new Date('2027-07-30T00:00:00.000Z'),
  );
  assert.equal(oldResult.status, 'fresh');
  assert.equal(oldResult.fresh, true);
  assert.equal(oldResult.maxAgeSeconds, null);
  assert.doesNotThrow(() => assertArtifactFresh(
    artifact,
    policy,
    new Date('2027-07-30T00:00:00.000Z'),
  ));

  const futureResult = checkArtifactFreshness(
    artifact,
    policy,
    new Date('2026-07-29T23:00:00.000Z'),
  );
  assert.equal(futureResult.status, 'future');
  assert.equal(futureResult.fresh, false);
  assert.throws(
    () => assertArtifactFresh(
      artifact,
      policy,
      new Date('2026-07-29T23:00:00.000Z'),
    ),
    /freshness gate failed: future/,
  );
});
