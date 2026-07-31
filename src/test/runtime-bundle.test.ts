import assert from 'node:assert/strict';
import test from 'node:test';

import { Catalog } from '../catalog.js';
import {
  RuntimeBundleStore,
  createClientRuntimeSnapshot,
  createRuntimeReconciliationBundle,
  createServerRuntimeSnapshot,
} from '../runtime/index.js';
import type {
  ClientBlockSnapshot,
  RuntimeProfile,
  ServerBlockSnapshot,
} from '../runtime/index.js';
import {
  privateRuntimeArtifact,
  testArtifact,
} from './fixtures.js';

const profile: RuntimeProfile = {
  environmentId: 'wordpress-only',
  productVersions: { wordpress: '1.0.0' },
  editorSurface: 'post-editor',
  locale: 'en_US',
  theme: { kind: 'block', slug: 'test' },
  featureFlags: {},
};
const registryFields = {
  apiVersion: 3,
  attributes: {},
  supports: {},
  parent: [],
  ancestor: [],
  allowedBlocks: [],
  providesContext: {},
  usesContext: [],
  variations: [],
  blockHooks: {},
};

function server(name: string): ServerBlockSnapshot {
  return {
    name,
    ...registryFields,
    isDynamic: false,
    callbacks: { render: false },
  };
}

function client(name: string): ClientBlockSnapshot {
  return {
    name,
    ...registryFields,
    inserterVisible: true,
    transforms: { from: [], to: [] },
    deprecations: [],
    callbacks: { edit: true, save: true },
  };
}

test('bundles reconciliations and preserves runtime-only names', () => {
  const capturedAt = '2026-07-30T00:00:00.000Z';
  const bundle = createRuntimeReconciliationBundle(
    new Catalog(testArtifact()),
    profile.environmentId,
    createServerRuntimeSnapshot({
      capturedAt,
      profile,
      blocks: [
        server('core/paragraph'),
        server('core/heading'),
        server('runtime/only'),
      ],
    }),
    createClientRuntimeSnapshot({
      capturedAt,
      profile,
      blocks: [ client('core/paragraph'), client('core/heading') ],
    }),
  );

  assert.equal(bundle.reconciliations.length, 2);
  assert.deepEqual(bundle.promotedDefinitions, []);
  assert.deepEqual(bundle.serverOnly, [ 'runtime/only' ]);
  assert.deepEqual(bundle.clientOnly, []);
  assert.deepEqual(bundle.sourceOnly, []);
});

test('promotes private runtime-only registrations with sealed provenance', () => {
  const capturedAt = '2026-07-30T00:00:00.000Z';
  const privateProfile: RuntimeProfile = {
    ...profile,
    environmentId: 'private-platform@deploy:eligible',
    productVersions: {
      wordpress: '1.0.0',
      'private-platform': 'deploy',
    },
    theme: { kind: 'classic', slug: 'test-theme' },
    featureFlags: { privateFeatureEnabled: true },
  };
  const catalog = new Catalog(privateRuntimeArtifact());
  const serverSnapshot = createServerRuntimeSnapshot({
    capturedAt,
    profile: privateProfile,
    blocks: [
      {
        ...server('example/runtime-only'),
        isDynamic: true,
        callbacks: { render: true },
      },
    ],
  });
  const clientSnapshot = createClientRuntimeSnapshot({
    capturedAt,
    profile: privateProfile,
    blocks: [ client('example/runtime-only') ],
  });
  const bundle = createRuntimeReconciliationBundle(
    catalog,
    privateProfile.environmentId,
    serverSnapshot,
    clientSnapshot,
  );

  assert.equal(bundle.promotedDefinitions.length, 1);
  const promoted = bundle.promotedDefinitions[0];
  assert.equal(promoted?.name, 'example/runtime-only');
  assert.equal(
    promoted?.sourceId,
    `runtime-observed:${privateProfile.environmentId}`,
  );
  assert.equal(promoted?.product, 'runtime-observed');
  assert.equal(promoted?.visibility, 'private');
  assert.deepEqual(promoted?.verification, [ 'runtime-observed' ]);
  assert.equal(promoted?.availability.sourcePresent, false);
  assert.equal(promoted?.runtimeProvenance?.profileHash, serverSnapshot.profileHash);
  assert.equal(
    promoted?.runtimeProvenance?.serverRegistryHash,
    serverSnapshot.registryHash,
  );
  assert.equal(
    promoted?.runtimeProvenance?.clientRegistryHash,
    clientSnapshot.registryHash,
  );
  assert.deepEqual(
    promoted?.runtimeProvenance?.origins,
    [ 'server', 'client' ],
  );
  assert.equal(promoted?.provenance.kind, 'runtime-capture');
  assert.equal(promoted?.provenance.repository, null);
  assert.equal(promoted?.provenance.ref, null);
  assert.equal(promoted?.provenance.commit, null);
  assert.equal(
    promoted?.runtimeProvenance?.observation.serverCapturedAt,
    serverSnapshot.capturedAt,
  );
  assert.equal(
    promoted?.runtimeProvenance?.observation.clientCapturedAt,
    clientSnapshot.capturedAt,
  );

  const runtimeOnly = bundle.reconciliations.find(
    ({ name }) => name === 'example/runtime-only',
  );
  assert.equal(runtimeOnly?.availability.state, 'included');
  assert.equal(runtimeOnly?.server?.isDynamic, true);
  assert.equal(runtimeOnly?.client?.inserterVisible, true);

  const excluded = bundle.reconciliations.find(
    ({ name }) => name === 'example/source-backed',
  );
  assert.equal(excluded?.availability.state, 'excluded');
  assert.equal(excluded?.availability.serverRegistered, false);
  assert.equal(excluded?.availability.clientRegistered, false);

  const effectiveCatalog = catalog.withDefinitions(bundle.promotedDefinitions);
  assert.equal(
    effectiveCatalog.resolve(
      'example/runtime-only',
      privateProfile.environmentId,
    )?.definition.runtimeProvenance?.environmentId,
    privateProfile.environmentId,
  );
  assert.deepEqual(
    effectiveCatalog.search({
      query: 'runtime-only',
      environment: privateProfile.environmentId,
    }).map(({ definition }) => definition.name),
    [ 'example/runtime-only' ],
  );

  const tampered = structuredClone(bundle);
  tampered.promotedDefinitions[0]!.runtimeProvenance!.profileHash =
    'f'.repeat(64);
  assert.throws(
    () => new RuntimeBundleStore([ tampered ]),
    /provenance must match its observation and bundle hashes/,
  );
});

test('promotes a server-only private registration without client claims', () => {
  const capturedAt = '2026-07-30T00:00:00.000Z';
  const privateProfile: RuntimeProfile = {
    ...profile,
    environmentId: 'private-platform@deploy:eligible',
    productVersions: {
      wordpress: '1.0.0',
      'private-platform': 'deploy',
    },
    featureFlags: { privateFeatureEnabled: true },
  };
  const catalog = new Catalog(privateRuntimeArtifact());
  const serverSnapshot = createServerRuntimeSnapshot({
    capturedAt,
    profile: privateProfile,
    blocks: [
      {
        ...server('example/runtime-only'),
        isDynamic: true,
        callbacks: { render: true },
      },
    ],
  });
  const bundle = createRuntimeReconciliationBundle(
    catalog,
    privateProfile.environmentId,
    serverSnapshot,
  );

  assert.equal(bundle.clientRegistryHash, null);
  assert.deepEqual(bundle.clientOnly, []);
  const promoted = bundle.promotedDefinitions[0];
  assert.equal(promoted?.name, 'example/runtime-only');
  assert.equal(promoted?.availability.serverRegistered, true);
  assert.equal(promoted?.availability.clientRegistered, null);
  assert.equal(promoted?.availability.inserterVisible, null);
  assert.equal(promoted?.runtimeProvenance?.clientRegistryHash, null);
  assert.deepEqual(promoted?.runtimeProvenance?.origins, [ 'server' ]);

  const reconciliation = bundle.reconciliations.find(
    ({ name }) => name === 'example/runtime-only',
  );
  assert.deepEqual(reconciliation?.observed, {
    serverSnapshot: true,
    clientSnapshot: false,
  });
  assert.equal(reconciliation?.availability.state, 'included');
  assert.equal(reconciliation?.availability.clientRegistered, null);
  assert.equal(reconciliation?.availability.inserterVisible, null);

  const sourceBacked = bundle.reconciliations.find(
    ({ name }) => name === 'example/source-backed',
  );
  assert.equal(sourceBacked?.availability.serverRegistered, false);
  assert.equal(sourceBacked?.availability.clientRegistered, null);
  assert.equal(sourceBacked?.availability.state, 'unknown');
});
