#!/usr/bin/env node

import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ExactEnvironmentSchema } from '../dist/verification/index.js';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
);
const hashPattern = /^[0-9a-f]{64}$/;

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

function sourceRecord(manifest, product) {
  if (
    manifest.product !== product ||
    manifest.visibility !== 'public' ||
    typeof manifest.id !== 'string' ||
    typeof manifest.productVersion !== 'string' ||
    !/^[0-9a-f]{40}$/.test(manifest.commit ?? '')
  ) {
    throw new Error(`Invalid public ${product} source manifest`);
  }
  return {
    sourceId: manifest.id,
    productVersion: manifest.productVersion,
    commit: manifest.commit,
  };
}

export async function createExactPublicEnvironment({
  environmentPath,
  wordpressSourcePath,
  productSourcePath,
  serverRawPath,
  serverPath,
  clientPath,
}) {
  const [
    environment,
    wordpressSource,
    productSource,
    serverRaw,
    server,
    client,
  ] = await Promise.all([
    readJson(environmentPath),
    readJson(wordpressSourcePath),
    readJson(productSourcePath),
    readJson(serverRawPath),
    readJson(serverPath),
    readJson(clientPath),
  ]);
  const wordpress = sourceRecord(wordpressSource, 'wordpress');
  const product = sourceRecord(productSource, 'jetpack');
  const wordpressVersion = environment.metadata?.wordpressVersion;
  const productVersion = environment.metadata?.jetpackVersion;
  const profile = server.profile;
  if (
    environment.visibility !== 'public' ||
    environment.id !==
      `wordpress@${wordpressVersion}+jetpack@${productVersion}` ||
    wordpress.productVersion !== wordpressVersion ||
    product.productVersion !== productVersion ||
    serverRaw.environmentId !== environment.id ||
    server.kind !== 'server' ||
    client.kind !== 'client' ||
    server.profileHash !== client.profileHash ||
    profile?.environmentId !== environment.id ||
    profile?.featureFlags?.connection !== 'disconnected' ||
    profile?.featureFlags?.offlineMode !== true
  ) {
    throw new Error('Runtime evidence does not match the public environment');
  }
  if (
    !/^\d+\.\d+\.\d+/.test(serverRaw.phpVersion ?? '') ||
    typeof serverRaw.timezone !== 'string' ||
    serverRaw.timezone.length === 0 ||
    !hashPattern.test(server.registryHash ?? '') ||
    !hashPattern.test(client.registryHash ?? '')
  ) {
    throw new Error('Runtime evidence lacks exact environment facts');
  }
  const slug =
    `wordpress-${wordpressVersion}-jetpack-${productVersion}-disconnected`;
  return ExactEnvironmentSchema.parse({
    id: environment.id,
    wordpressVersion,
    phpVersion: serverRaw.phpVersion,
    locale: environment.metadata.locale,
    timezone: serverRaw.timezone,
    sources: [ wordpress, product ],
    runtimeComponents: [
      {
        name: 'server-registry',
        version: `${slug}-php-${serverRaw.phpVersion}`,
        artifactHash: server.registryHash,
      },
      {
        name: 'client-registry',
        version: `${slug}-post-editor`,
        artifactHash: client.registryHash,
      },
    ],
  });
}

async function main() {
  const [
    environmentPath,
    wordpressSourcePath,
    productSourcePath,
    serverRawPath,
    serverPath,
    clientPath,
    outputPath,
  ] = process.argv.slice(2);
  if (
    !environmentPath ||
    !wordpressSourcePath ||
    !productSourcePath ||
    !serverRawPath ||
    !serverPath ||
    !clientPath ||
    !outputPath
  ) {
    throw new Error(
      'Usage: node scripts/create-exact-public-environment.mjs ' +
      '<environment.json> <wordpress-source.json> <product-source.json> ' +
      '<server.raw.json> <server.json> <client.json> <output.json>',
    );
  }
  const exact = await createExactPublicEnvironment({
    environmentPath,
    wordpressSourcePath,
    productSourcePath,
    serverRawPath,
    serverPath,
    clientPath,
  });
  const output = resolve(outputPath);
  const temporary = `${output}.tmp-${process.pid}`;
  await writeFile(
    temporary,
    `${JSON.stringify(exact, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  await rename(temporary, output);
  process.stdout.write(`Created exact environment ${exact.id}\n`);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    process.stderr.write(
      `Exact environment creation failed closed: ${error.message}\n`,
    );
    process.exitCode = 1;
  });
}

export { repositoryRoot };
