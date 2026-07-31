import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
  EnvironmentSchema,
  SourceManifestSchema,
} from '../schema.js';

async function jsonFiles(directory: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((path) => path.endsWith('.json'))
    .sort();
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

test('checked-in source and environment manifests satisfy the contract', async () => {
  const root = process.cwd();
  const sourceRoot = join(root, 'sources');
  const environmentRoot = join(root, 'environments');
  const sourceFiles = await jsonFiles(sourceRoot);
  const environmentFiles = await jsonFiles(environmentRoot);

  assert.ok(sourceFiles.length > 0);
  assert.ok(environmentFiles.length > 0);

  const sources = await Promise.all(
    sourceFiles.map(async (file) =>
      SourceManifestSchema.parse(await readJson(join(sourceRoot, file)))),
  );
  const environments = await Promise.all(
    environmentFiles.map(async (file) =>
      EnvironmentSchema.parse(await readJson(join(environmentRoot, file)))),
  );
  const sourceIds = new Set(sources.map(({ id }) => id));

  for (const environment of environments) {
    for (const layer of environment.layers) {
      assert.ok(
        sourceIds.has(layer.sourceId),
        `${environment.id} references missing source ${layer.sourceId}`,
      );
    }
  }
});
