import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { Catalog } from '../catalog.js';
import { createServer } from '../mcp/create-server.js';
import {
  RuntimeBundleStore,
  createClientRuntimeSnapshot,
  createRuntimeReconciliationBundle,
  createServerRuntimeSnapshot,
} from '../runtime/index.js';
import {
  privateRuntimeArtifact,
  testArtifact,
} from './fixtures.js';

test('serves resolved search results through MCP', async (t) => {
  const [ clientTransport, serverTransport ] =
    InMemoryTransport.createLinkedPair();
  const server = createServer(new Catalog(testArtifact()));
  const client = new Client({
    name: 'catalogue-test-client',
    version: '1.0.0',
  });

  t.after(async () => {
    await client.close();
    await server.close();
  });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map(({ name }) => name).sort(),
    [
      'compare_block_versions',
      'generate_markup',
      'get_block',
      'get_block_markup',
      'get_block_schema',
      'get_runtime_drift',
      'get_verification_evidence',
      'list_block_attributes',
      'list_environments',
      'search_blocks',
      'search_variations',
      'validate_markup',
    ],
  );

  const resources = await client.listResources();
  assert.deepEqual(
    resources.resources.map(({ uri }) => uri),
    [ 'wp-block-catalog://manifest' ],
  );
  const templates = await client.listResourceTemplates();
  assert.deepEqual(
    templates.resourceTemplates.map(({ uriTemplate }) => uriTemplate),
    [ 'wp-block-catalog://blocks/{environment}/{name}' ],
  );
  const manifest = await client.readResource({
    uri: 'wp-block-catalog://manifest',
  });
  const manifestText = manifest.contents[0];
  assert.equal(manifestText?.mimeType, 'application/json');
  const manifestString =
    manifestText && 'text' in manifestText ? manifestText.text : '';
  assert.match(
    manifestString,
    /"catalogVersion":"test-1"/,
  );

  const environments = await client.callTool({
    name: 'list_environments',
    arguments: {},
  });
  const environmentContent = environments.structuredContent as {
    environments: Array<{ id: string }>;
  };
  assert.deepEqual(
    environmentContent.environments.map(({ id }) => id),
    [ 'wordpress-only', 'wordpress-with-gutenberg' ],
  );

  const result = await client.callTool({
    name: 'search_blocks',
    arguments: {
      query: 'paragraph',
      environment: 'wordpress-with-gutenberg',
    },
  });

  assert.equal(result.isError, undefined);
  const structured = result.structuredContent as {
    results: Array<{
      name: string;
      product: string;
      productVersion: string;
      provenance: { commit: string };
      shadowedSources: string[];
    }>;
  };
  assert.equal(structured.results.length, 1);
  assert.equal(structured.results[0]?.name, 'core/paragraph');
  assert.equal(structured.results[0]?.product, 'gutenberg');
  assert.equal(structured.results[0]?.productVersion, '2.0.0');
  assert.equal(structured.results[0]?.provenance.commit, '2'.repeat(40));
  assert.deepEqual(
    structured.results[0]?.shadowedSources,
    [ 'wordpress@1.0.0' ],
  );

  const comparison = await client.callTool({
    name: 'compare_block_versions',
    arguments: {
      name: 'core/paragraph',
      fromEnvironment: 'wordpress-only',
      toEnvironment: 'wordpress-with-gutenberg',
    },
  });
  const compared = comparison.structuredContent as {
    changed: boolean;
    changes: Array<{ field: string }>;
  };
  assert.equal(compared.changed, true);
  assert.ok(compared.changes.some(({ field }) => field === 'sourceId'));

  const unverified = await client.callTool({
    name: 'validate_markup',
    arguments: {
      environment: 'wordpress-only',
      markup: '<!-- wp:paragraph --><p>Unknown</p><!-- /wp:paragraph -->',
    },
  });
  assert.equal(
    (unverified.structuredContent as { verified: boolean }).verified,
    false,
  );

  const compatibilityServer = createServer(
    new Catalog(testArtifact()),
    undefined,
    undefined,
    { defaultEnvironment: 'wordpress-with-gutenberg' },
  );
  const [ compatibilityClientTransport, compatibilityServerTransport ] =
    InMemoryTransport.createLinkedPair();
  const compatibilityClient = new Client({
    name: 'prototype-compatibility-test-client',
    version: '1.0.0',
  });
  t.after(async () => {
    await compatibilityClient.close();
    await compatibilityServer.close();
  });
  await compatibilityServer.connect(compatibilityServerTransport);
  await compatibilityClient.connect(compatibilityClientTransport);

  const schema = await compatibilityClient.callTool({
    name: 'get_block_schema',
    arguments: { block_name: 'core/paragraph' },
  });
  assert.equal(schema.isError, undefined);
  assert.equal(
    (
      schema.structuredContent as {
        definition: { sourceId: string };
      }
    ).definition.sourceId,
    'gutenberg@2.0.0',
  );
});

test('serves promoted runtime-only definitions only through a private MCP', async (t) => {
  const environmentId = 'private-platform@deploy:eligible';
  const profile = {
    environmentId,
    productVersions: {
      wordpress: '1.0.0',
      'private-platform': 'deploy',
    },
    editorSurface: 'post-editor',
    locale: 'en_US',
    theme: { kind: 'classic', slug: 'test-theme' },
    featureFlags: { privateFeatureEnabled: true },
  };
  const registryFields = {
    name: 'example/runtime-only',
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
  const capturedAt = '2026-07-30T00:00:00.000Z';
  const catalog = new Catalog(privateRuntimeArtifact());
  const bundle = createRuntimeReconciliationBundle(
    catalog,
    environmentId,
    createServerRuntimeSnapshot({
      capturedAt,
      profile,
      blocks: [
        {
          ...registryFields,
          isDynamic: true,
          callbacks: { render: true },
        },
      ],
    }),
    createClientRuntimeSnapshot({
      capturedAt,
      profile,
      blocks: [
        {
          ...registryFields,
          inserterVisible: true,
          transforms: { from: [], to: [] },
          deprecations: [],
          callbacks: { edit: true, save: true },
        },
      ],
    }),
  );
  const runtimeBundles = new RuntimeBundleStore([ bundle ]);
  const server = createServer(catalog, undefined, runtimeBundles);
  const [ clientTransport, serverTransport ] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: 'private-catalogue-test-client',
    version: '1.0.0',
  });
  t.after(async () => {
    await client.close();
    await server.close();
  });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const search = await client.callTool({
    name: 'search_blocks',
    arguments: {
      query: 'runtime-only',
      environment: environmentId,
    },
  });
  const searchContent = search.structuredContent as {
    results: Array<{
      name: string;
      sourceId: string;
      product: string;
      availability: { state: string };
      runtimeProvenance: {
        profileHash: string;
      };
    }>;
  };
  assert.equal(searchContent.results[0]?.name, 'example/runtime-only');
  assert.equal(searchContent.results[0]?.availability.state, 'included');
  assert.equal(
    searchContent.results[0]?.sourceId,
    `runtime-observed:${environmentId}`,
  );
  assert.equal(searchContent.results[0]?.product, 'runtime-observed');
  assert.equal(
    searchContent.results[0]?.runtimeProvenance.profileHash,
    bundle.profileHash,
  );

  const block = await client.callTool({
    name: 'get_block',
    arguments: {
      name: 'example/runtime-only',
      environment: environmentId,
    },
  });
  const blockContent = block.structuredContent as {
    definition: {
      visibility: string;
      verification: string[];
      runtimeProvenance: { serverRegistryHash: string };
    };
    runtime: {
      server: { isDynamic: boolean };
      availability: { state: string };
    };
  };
  assert.equal(blockContent.definition.visibility, 'private');
  assert.deepEqual(
    blockContent.definition.verification,
    [ 'runtime-observed' ],
  );
  assert.equal(
    blockContent.definition.runtimeProvenance.serverRegistryHash,
    bundle.serverRegistryHash,
  );
  assert.equal(blockContent.runtime.server.isDynamic, true);
  assert.equal(blockContent.runtime.availability.state, 'included');

  assert.throws(
    () => createServer(
      new Catalog(testArtifact()),
      undefined,
      runtimeBundles,
    ),
    /requires its private environment/,
  );
});

test('serves server-only promotion without inventing a client observation', async (t) => {
  const environmentId = 'private-platform@deploy:eligible';
  const profile = {
    environmentId,
    productVersions: {
      wordpress: '1.0.0',
      'private-platform': 'deploy',
    },
    editorSurface: 'post-editor',
    locale: 'en_US',
    theme: { kind: 'classic', slug: 'test-theme' },
    featureFlags: { privateFeatureEnabled: true },
  };
  const catalog = new Catalog(privateRuntimeArtifact());
  const bundle = createRuntimeReconciliationBundle(
    catalog,
    environmentId,
    createServerRuntimeSnapshot({
      capturedAt: '2026-07-30T00:00:00.000Z',
      profile,
      blocks: [
        {
          name: 'example/runtime-only',
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
          isDynamic: true,
          callbacks: { render: true },
        },
      ],
    }),
  );
  const server = createServer(
    catalog,
    undefined,
    new RuntimeBundleStore([ bundle ]),
  );
  const [ clientTransport, serverTransport ] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: 'private-server-only-test-client',
    version: '1.0.0',
  });
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const search = await client.callTool({
    name: 'search_blocks',
    arguments: {
      query: 'runtime-only',
      environment: environmentId,
    },
  });
  const searchContent = search.structuredContent as {
    results: Array<{
      availability: {
        serverRegistered: boolean;
        clientRegistered: boolean | null;
        inserterVisible: boolean | null;
      };
      runtimeProvenance: {
        clientRegistryHash: string | null;
        origins: string[];
      };
    }>;
  };
  assert.equal(searchContent.results[0]?.availability.serverRegistered, true);
  assert.equal(searchContent.results[0]?.availability.clientRegistered, null);
  assert.equal(searchContent.results[0]?.availability.inserterVisible, null);
  assert.equal(
    searchContent.results[0]?.runtimeProvenance.clientRegistryHash,
    null,
  );
  assert.deepEqual(
    searchContent.results[0]?.runtimeProvenance.origins,
    [ 'server' ],
  );

  const block = await client.callTool({
    name: 'get_block',
    arguments: {
      name: 'example/runtime-only',
      environment: environmentId,
    },
  });
  const blockContent = block.structuredContent as {
    runtime: {
      observed: {
        serverSnapshot: boolean;
        clientSnapshot: boolean;
      };
      client: unknown;
    };
  };
  assert.deepEqual(blockContent.runtime.observed, {
    serverSnapshot: true,
    clientSnapshot: false,
  });
  assert.equal(blockContent.runtime.client, null);

  const manifestResponse = await client.readResource({
    uri: 'wp-block-catalog://manifest',
  });
  const manifestContent = manifestResponse.contents[0];
  assert.ok(manifestContent && 'text' in manifestContent);
  const manifest = JSON.parse(manifestContent.text) as {
    runtime: Array<{ clientRegistryHash: string | null }>;
  };
  assert.equal(manifest.runtime[0]?.clientRegistryHash, null);
});
