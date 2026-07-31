import assert from 'node:assert/strict';
import { delimiter, resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';

const root = resolve(import.meta.dirname, '..');
const environments = {
  core: 'wordpress@7.0.2',
  gutenberg: 'wordpress@7.0.2+gutenberg@23.6.2',
  woocommerce: 'wordpress@7.0.2+woocommerce@10.9.4',
  jetpack: 'wordpress@7.0.2+jetpack@16.0.1',
};
const runtimeFiles = [
  'wordpress-7.0.2-post-editor.reconciled.json',
  'wordpress-7.0.2-gutenberg-23.6.2-post-editor.reconciled.json',
  'wordpress-7.0.2-woocommerce-10.9.4-post-editor.reconciled.json',
  'wordpress-7.0.2-jetpack-16.0.1-disconnected-post-editor.reconciled.json',
].map((file) => resolve(root, 'runtime', file));
const verificationFiles = [
  'wordpress-7.0.2.verified-markup.json',
  'wordpress-7.0.2-gutenberg-23.6.2.verified-markup.json',
  'wordpress-7.0.2-woocommerce-10.9.4.verified-markup.json',
  'wordpress-7.0.2-jetpack-16.0.1-disconnected.verified-markup.json',
].map((file) => resolve(root, 'runtime', file));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [ resolve(root, 'dist', 'mcp', 'server.js') ],
  env: {
    ...process.env,
    WP_BLOCK_CATALOG_PATH: resolve(
      root,
      'catalog',
      'public.release.generated.json',
    ),
    WP_BLOCK_DEFAULT_ENVIRONMENT: environments.core,
    WP_BLOCK_RUNTIME_PATHS: runtimeFiles.join(delimiter),
    WP_BLOCK_VERIFICATION_PATHS: verificationFiles.join(delimiter),
  },
});
const client = new Client({
  name: 'wp-block-catalog-smoke',
  version: '1.0.0',
});

try {
  await client.connect(transport);

  const tools = await client.listTools();
  const toolNames = tools.tools.map(({ name }) => name);
  for (const name of [
    'search_blocks',
    'get_block',
    'compare_block_versions',
    'generate_markup',
    'validate_markup',
    'get_verification_evidence',
    'get_runtime_drift',
    'get_block_schema',
    'get_block_markup',
    'list_block_attributes',
    'search_variations',
  ]) {
    assert.ok(toolNames.includes(name), `Missing MCP tool ${name}`);
  }

  const listed = await client.callTool({
    name: 'list_environments',
    arguments: {},
  });
  const listedContent = listed.structuredContent;
  assert.ok(listedContent && Array.isArray(listedContent.environments));
  assert.equal(
    listedContent.environments.filter(({ runtime }) => runtime !== null).length,
    4,
  );

  const manifestResponse = await client.readResource({
    uri: 'wp-block-catalog://manifest',
  });
  const manifestContent = manifestResponse.contents[0];
  assert.ok(manifestContent && 'text' in manifestContent);
  const manifest = JSON.parse(manifestContent.text);
  assert.equal(manifest.runtime.length, 4);

  const prototypeMarkup = await client.callTool({
    name: 'get_block_markup',
    arguments: { block_name: 'core/paragraph', validated_only: true },
  });
  assert.equal(prototypeMarkup.isError, undefined);
  assert.equal(prototypeMarkup.structuredContent.verified, true);

  const coreBlock = await client.callTool({
    name: 'get_block',
    arguments: {
      environment: environments.core,
      name: 'core/paragraph',
    },
  });
  assert.equal(coreBlock.structuredContent.evidence.length, 1);

  const gutenbergSearch = await client.callTool({
    name: 'search_blocks',
    arguments: {
      query: 'paragraph',
      environment: environments.gutenberg,
      limit: 1,
    },
  });
  assert.equal(gutenbergSearch.structuredContent.results[0].name, 'core/paragraph');
  assert.equal(
    gutenbergSearch.structuredContent.results[0].availability.clientRegistered,
    true,
  );

  const wooMarkup = await client.callTool({
    name: 'generate_markup',
    arguments: {
      environment: environments.woocommerce,
      name: 'woocommerce/store-notices',
      attributes: { align: 'wide' },
    },
  });
  assert.equal(wooMarkup.isError, undefined);
  assert.equal(
    wooMarkup.structuredContent.evidence.labelsGranted[0],
    'server-render-valid',
  );

  const jetpackDrift = await client.callTool({
    name: 'get_runtime_drift',
    arguments: {
      environment: environments.jetpack,
      name: 'jetpack/business-hours',
    },
  });
  assert.equal(jetpackDrift.structuredContent.observed, true);
  assert.equal(
    jetpackDrift.structuredContent.runtime.availability.state,
    'excluded',
  );

  process.stdout.write(`${JSON.stringify({
    tools: toolNames.length,
    resources: 2,
    runtimeEnvironments: manifest.runtime.length,
    corePrototypeMarkup: true,
    blockResponseEvidence: true,
    gutenbergClientRegistration: true,
    wooDynamicRender: true,
    jetpackDisconnectedExclusion: true,
  }, null, 2)}\n`);
} finally {
  await client.close();
}
