import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFile } from 'node:fs/promises';
import { delimiter } from 'node:path';

import { loadCatalog } from '../load.js';
import { RuntimeBundleStore } from '../runtime/index.js';
import { VerifiedMarkupStore } from '../verified.js';
import { createServer } from './create-server.js';

function configuredPaths(
  singular: string | undefined,
  plural: string | undefined,
): string[] {
  return [
    ...(singular ? [ singular ] : []),
    ...(plural ? plural.split(delimiter) : []),
  ].filter((path, index, paths) =>
    path.length > 0 && paths.indexOf(path) === index);
}

async function readJsonFiles(paths: string[]): Promise<unknown[]> {
  return Promise.all(paths.map(async (path) =>
    JSON.parse(await readFile(path, 'utf8'))));
}

const catalogPath = process.env.WP_BLOCK_CATALOG_PATH;
if (!catalogPath) {
  throw new Error('WP_BLOCK_CATALOG_PATH must point to a catalogue JSON artefact');
}

const catalog = await loadCatalog(catalogPath);
const verifiedMarkup = new VerifiedMarkupStore(
  await readJsonFiles(configuredPaths(
    process.env.WP_BLOCK_VERIFICATION_PATH,
    process.env.WP_BLOCK_VERIFICATION_PATHS,
  )),
);
const runtimeBundles = new RuntimeBundleStore(
  await readJsonFiles(configuredPaths(
    process.env.WP_BLOCK_RUNTIME_PATH,
    process.env.WP_BLOCK_RUNTIME_PATHS,
  )),
);
const defaultEnvironment = process.env.WP_BLOCK_DEFAULT_ENVIRONMENT;
const server = createServer(
  catalog,
  verifiedMarkup,
  runtimeBundles,
  defaultEnvironment ? { defaultEnvironment } : {},
);
await server.connect(new StdioServerTransport());
