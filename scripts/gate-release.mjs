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

async function evaluateOne({
  visibility,
  policyPath,
  previousPath,
  nextPath,
}) {
  const policy = ReleaseGatePolicySchema.parse(
    await readJson(policyPath),
  );
  if (policy.visibility !== visibility) {
    throw new Error(`${visibility} release policy visibility mismatch`);
  }
  const result = evaluateReleaseGates(
    await readJson(previousPath),
    await readJson(nextPath),
    policy,
  );
  return {
    passed: result.passed,
    freshness: result.freshness.status,
    unexplainedRemovalCount: result.unexplainedRemovals.length,
    counts: result.summary.counts,
  };
}

export async function gateRelease(
  previousPublicPath,
  {
    publicPolicyPath = resolve(
      repositoryRoot,
      'policies/public-release.json',
    ),
    publicNextPath = resolve(
      repositoryRoot,
      'catalog/public.release.generated.json',
    ),
  } = {},
) {
  const publicResult = await evaluateOne({
    visibility: 'public',
    policyPath: publicPolicyPath,
    previousPath: previousPublicPath,
    nextPath: publicNextPath,
  });
  return {
    passed: publicResult.passed,
    public: publicResult,
  };
}

async function main() {
  const [ previousPublicPath ] = process.argv.slice(2);
  if (!previousPublicPath) {
    throw new Error(
      'Usage: node scripts/gate-release.mjs ' +
      '<previous-public.json>',
    );
  }
  const result = await gateRelease(previousPublicPath);
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
    process.stderr.write(`Release gate failed closed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
