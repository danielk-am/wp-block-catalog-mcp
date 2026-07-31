#!/usr/bin/env node

import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  join,
  resolve,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildCatalog } from '../dist/build.js';
import {
  hashArtifact,
  prepareDeliveryArtifact,
} from '../dist/delivery/index.js';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
);

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

export function assertMatchingArtifact(
  rebuilt,
  committed,
  label,
) {
  const rebuiltHash = hashArtifact(rebuilt);
  const committedHash = hashArtifact(committed);
  if (rebuiltHash !== committedHash) {
    throw new Error(`${label} does not match its deterministic source build`);
  }
  return rebuiltHash;
}

export async function verifyOne({
  visibility,
  configPath,
  releasePath,
  checkoutRoot,
  temporary,
}) {
  const absoluteConfigPath = resolve(configPath);
  const configDirectory = dirname(absoluteConfigPath);
  const config = await readJson(absoluteConfigPath);
  if (config.visibility !== visibility) {
    throw new Error(`${visibility} build visibility mismatch`);
  }
  const temporaryOutputPath = join(
    temporary,
    `${visibility}.generated.json`,
  );
  const temporaryConfigPath = join(
    temporary,
    `${visibility}.build.json`,
  );
  const temporaryConfig = {
    ...config,
    output: temporaryOutputPath,
    sources: config.sources.map((source) => ({
      ...source,
      manifest: resolve(configDirectory, source.manifest),
      checkout: checkoutRoot
        ? resolve(checkoutRoot, basename(source.checkout))
        : resolve(configDirectory, source.checkout),
    })),
    environmentFiles: config.environmentFiles.map((path) =>
      resolve(configDirectory, path)),
  };
  await writeFile(
    temporaryConfigPath,
    `${JSON.stringify(temporaryConfig, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );

  const rebuilt = await buildCatalog(temporaryConfigPath);
  const committedRelease = await readJson(releasePath);
  const rebuiltRelease = prepareDeliveryArtifact(rebuilt, visibility);
  assertMatchingArtifact(
    rebuiltRelease,
    committedRelease,
    `${visibility} release catalogue`,
  );
  return {
    passed: true,
    counts: {
      sources: rebuilt.sources.length,
      environments: rebuilt.environments.length,
      definitions: rebuilt.blocks.length,
      blockNames: new Set(rebuilt.blocks.map(({ name }) => name)).size,
    },
  };
}

export async function verifyCatalogBuild({
  checkoutRoot = process.env.WP_BLOCK_CATALOG_CHECKOUT_ROOT,
} = {}) {
  const temporary = await mkdtemp(
    join(tmpdir(), 'wp-block-catalog-rebuild-'),
  );
  try {
    const publicResult = await verifyOne({
      visibility: 'public',
      configPath: resolve(repositoryRoot, 'build/public.json'),
      releasePath: resolve(
        repositoryRoot,
        'catalog/public.release.generated.json',
      ),
      checkoutRoot,
      temporary,
    });
    return {
      passed: true,
      public: publicResult,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function main() {
  const result = await verifyCatalogBuild();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`Catalogue rebuild check failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
