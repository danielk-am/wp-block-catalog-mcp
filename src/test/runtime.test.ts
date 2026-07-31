import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeBlockMetadata } from '../normalize.js';
import {
  ClientBlockSnapshotSchema,
  createClientRuntimeSnapshot,
  createServerRuntimeSnapshot,
  hashRuntimeProfile,
  parseClientRuntimeSnapshot,
  reconcileRuntime,
} from '../runtime/index.js';
import type {
  ClientBlockSnapshot,
  RuntimeProfile,
  ServerBlockSnapshot,
} from '../runtime/index.js';
import { coreSource } from './fixtures.js';

const capturedAt = '2026-07-30T00:00:00.000Z';

function profile(): RuntimeProfile {
  return {
    environmentId: 'wordpress-with-plugin',
    productVersions: {
      wordpress: '7.0.2',
      extension: '1.2.3',
    },
    editorSurface: 'post-editor',
    locale: 'en_US',
    theme: {
      kind: 'block',
      slug: 'twentytwentysix',
    },
    featureFlags: {
      forms: false,
      nested: { enabled: true },
    },
  };
}

function serverBlock(
  overrides: Partial<ServerBlockSnapshot> = {},
): ServerBlockSnapshot {
  return {
    name: 'core/paragraph',
    apiVersion: 3,
    attributes: {
      content: { type: 'string', source: 'rich-text' },
    },
    supports: { anchor: true },
    parent: [],
    ancestor: [],
    allowedBlocks: [],
    providesContext: {},
    usesContext: [],
    variations: [],
    blockHooks: {},
    isDynamic: false,
    callbacks: { render: false },
    ...overrides,
  };
}

function clientBlock(
  overrides: Partial<ClientBlockSnapshot> = {},
): ClientBlockSnapshot {
  return {
    name: 'core/paragraph',
    apiVersion: 3,
    attributes: {
      content: { type: 'string', source: 'rich-text' },
    },
    supports: { anchor: true },
    parent: [],
    ancestor: [],
    allowedBlocks: [],
    providesContext: {},
    usesContext: [],
    variations: [],
    blockHooks: {},
    inserterVisible: true,
    transforms: { from: [], to: [] },
    deprecations: [],
    callbacks: { edit: true, save: true },
    ...overrides,
  };
}

function sourceBlock() {
  return normalizeBlockMetadata(
    {
      name: 'core/paragraph',
      title: 'Paragraph',
      apiVersion: 3,
      attributes: {
        content: { type: 'string', source: 'rich-text' },
      },
      supports: { anchor: true },
    },
    {
      source: coreSource,
      path: 'src/wp-includes/blocks/paragraph/block.json',
    },
  );
}

test('profile and registry hashes ignore object and block insertion order', () => {
  const firstProfile = profile();
  const secondProfile: RuntimeProfile = {
    ...firstProfile,
    productVersions: {
      extension: '1.2.3',
      wordpress: '7.0.2',
    },
    featureFlags: {
      nested: { enabled: true },
      forms: false,
    },
  };

  assert.equal(
    hashRuntimeProfile(firstProfile),
    hashRuntimeProfile(secondProfile),
  );

  const first = createServerRuntimeSnapshot({
    capturedAt,
    profile: firstProfile,
    blocks: [
      serverBlock({ name: 'core/quote' }),
      serverBlock(),
    ],
  });
  const second = createServerRuntimeSnapshot({
    capturedAt: '2026-07-30T01:00:00.000Z',
    profile: secondProfile,
    blocks: [
      serverBlock(),
      serverBlock({ name: 'core/quote' }),
    ],
  });

  assert.equal(first.registryHash, second.registryHash);
  assert.deepEqual(
    first.blocks.map((block) => block.name),
    [ 'core/paragraph', 'core/quote' ],
  );
});

test('snapshot integrity detects registry tampering', () => {
  const snapshot = createClientRuntimeSnapshot({
    capturedAt,
    profile: profile(),
    blocks: [ clientBlock() ],
  });

  assert.throws(
    () =>
      parseClientRuntimeSnapshot({
        ...snapshot,
        blocks: [ { ...snapshot.blocks[0], apiVersion: 2 } ],
      }),
    /registry hash mismatch/,
  );
});

test('callback contracts accept presence booleans only', () => {
  assert.throws(
    () =>
      ClientBlockSnapshotSchema.parse({
        ...clientBlock(),
        callbacks: {
          edit: true,
          save: true,
          implementation: 'function save() {}',
        },
      }),
  );
  assert.throws(
    () =>
      ClientBlockSnapshotSchema.parse({
        ...clientBlock(),
        callbacks: {
          edit: () => null,
          save: true,
        },
      }),
  );
});

test('transform contracts preserve WordPress wildcard sources', () => {
  assert.doesNotThrow(() =>
    ClientBlockSnapshotSchema.parse(
      clientBlock({
        transforms: {
          from: [
            {
              type: 'block',
              blockNames: [ '*' ],
              priority: null,
              isMultiBlock: null,
              callbacks: { transform: true, isMatch: false },
            },
          ],
          to: [],
        },
      }),
    ));
});

test('reconciliation preserves all views and reports pairwise drift', () => {
  const runtimeProfile = profile();
  const server = createServerRuntimeSnapshot({
    capturedAt,
    profile: runtimeProfile,
    blocks: [
      serverBlock({
        apiVersion: 2,
        supports: { anchor: false },
      }),
    ],
  });
  const client = createClientRuntimeSnapshot({
    capturedAt,
    profile: runtimeProfile,
    blocks: [
      clientBlock({
        supports: { anchor: true, color: true },
      }),
    ],
  });

  const reconciled = reconcileRuntime({
    source: sourceBlock(),
    profile: runtimeProfile,
    server,
    client,
  });

  assert.equal(reconciled.source.apiVersion, 3);
  assert.equal(reconciled.server?.apiVersion, 2);
  assert.deepEqual(reconciled.client?.supports, {
    anchor: true,
    color: true,
  });
  assert.deepEqual(reconciled.availability, {
    sourcePresent: true,
    includedInBuild: true,
    serverRegistered: true,
    clientRegistered: true,
    inserterVisible: true,
    editorSurfaces: [ 'post-editor' ],
    experimental: null,
    gates: [],
    state: 'included',
  });
  assert.ok(
    reconciled.drift.some(
      (item) =>
        item.field === 'apiVersion' &&
        item.left.origin === 'source' &&
        item.right.origin === 'server',
    ),
  );
  assert.ok(
    reconciled.drift.some(
      (item) =>
        item.field === 'supports' &&
        item.left.origin === 'server' &&
        item.right.origin === 'client',
    ),
  );
});

test('complete absent registries produce explicit gated availability', () => {
  const runtimeProfile = profile();
  const source = sourceBlock();
  source.availability.experimental = true;
  source.availability.gates = [ 'forms' ];
  source.availability.state = 'gated';

  const reconciled = reconcileRuntime({
    source,
    profile: runtimeProfile,
    server: createServerRuntimeSnapshot({
      capturedAt,
      profile: runtimeProfile,
      blocks: [],
    }),
    client: createClientRuntimeSnapshot({
      capturedAt,
      profile: runtimeProfile,
      blocks: [],
    }),
  });

  assert.equal(reconciled.availability.serverRegistered, false);
  assert.equal(reconciled.availability.clientRegistered, false);
  assert.equal(reconciled.availability.inserterVisible, false);
  assert.equal(reconciled.availability.state, 'gated');
  assert.deepEqual(reconciled.availability.gates, [ 'forms' ]);
  assert.ok(
    reconciled.drift.some(
      (item) =>
        item.field === 'registration' &&
        item.left.origin === 'source' &&
        item.right.origin === 'server',
    ),
  );
});

test('registered client preserves unknown inserter visibility', () => {
  const runtimeProfile = profile();
  const reconciled = reconcileRuntime({
    source: sourceBlock(),
    profile: runtimeProfile,
    client: createClientRuntimeSnapshot({
      capturedAt,
      profile: runtimeProfile,
      blocks: [ clientBlock({ inserterVisible: null }) ],
    }),
  });

  assert.equal(reconciled.availability.clientRegistered, true);
  assert.equal(reconciled.availability.serverRegistered, null);
  assert.equal(reconciled.availability.inserterVisible, null);
});
