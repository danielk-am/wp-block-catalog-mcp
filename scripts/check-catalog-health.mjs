#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  ReleaseGatePolicySchema,
  evaluateReleaseGates,
} from '../dist/diff/index.js';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
);

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

async function evaluateHealth({
  visibility,
  policyPath,
  artifactPath,
  emptyPath,
}) {
  const policy = ReleaseGatePolicySchema.parse(
    await readJson(policyPath),
  );
  if (policy.visibility !== visibility) {
    throw new Error(`${visibility} health policy visibility mismatch`);
  }
  const result = evaluateReleaseGates(
    await readJson(emptyPath),
    await readJson(artifactPath),
    policy,
  );
  return {
    passed: result.passed,
    freshness: result.freshness.status,
    unexplainedRemovalCount: result.unexplainedRemovals.length,
    counts: result.summary.counts,
  };
}

export async function checkCatalogHealth({
  publicPolicyPath = resolve(
    repositoryRoot,
    'policies/public-health.json',
  ),
  publicArtifactPath = resolve(
    repositoryRoot,
    'catalog/public.release.generated.json',
  ),
  emptyPath = resolve(repositoryRoot, 'fixtures/empty-catalog.json'),
} = {}) {
  const publicResult = await evaluateHealth({
    visibility: 'public',
    policyPath: publicPolicyPath,
    artifactPath: publicArtifactPath,
    emptyPath,
  });
  return {
    passed: publicResult.passed,
    public: publicResult,
  };
}

async function main() {
  const result = await checkCatalogHealth();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.passed) {
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`Catalogue health check failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
