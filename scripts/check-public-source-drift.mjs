#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const defaultPolicyPath = resolve(
  dirname(scriptPath),
  '..',
  'policies',
  'public-source-maintenance.json',
);

export const EXIT_CODES = Object.freeze({
  current: 0,
  update: 10,
  indeterminate: 20,
});

function objectValue(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function stringValue(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function validatePolicy(input) {
  const policy = objectValue(input, 'Policy');
  if (policy.schemaVersion !== 1) {
    throw new Error('Policy schemaVersion must be 1');
  }
  stringValue(policy.buildConfig, 'Policy buildConfig');
  if (!Array.isArray(policy.sources) || policy.sources.length === 0) {
    throw new Error('Policy sources must be a non-empty array');
  }

  const products = new Set();
  for (const [ index, sourceInput ] of policy.sources.entries()) {
    const source = objectValue(sourceInput, `Policy source ${index}`);
    const product = stringValue(
      source.product,
      `Policy source ${index} product`,
    );
    if (products.has(product)) {
      throw new Error(`Duplicate policy product ${product}`);
    }
    products.add(product);
    stringValue(
      source.repository,
      `Policy source ${product} repository`,
    );
    if (source.channel !== 'stable' && source.channel !== 'prerelease') {
      throw new Error(
        `Policy source ${product} channel must be stable or prerelease`,
      );
    }
    const discovery = objectValue(
      source.discovery,
      `Policy source ${product} discovery`,
    );
    if (
      discovery.kind !== 'git-tags' ||
      discovery.branchFallback !== false
    ) {
      throw new Error(
        `Policy source ${product} must use tags without branch fallback`,
      );
    }
    const tagPattern = stringValue(
      source.tagPattern,
      `Policy source ${product} tagPattern`,
    );
    const match = new RegExp(tagPattern).exec('0.0.0-test');
    if (match && !match.groups?.version) {
      throw new Error(
        `Policy source ${product} tagPattern needs a version group`,
      );
    }
    if (!tagPattern.includes('?<version>')) {
      throw new Error(
        `Policy source ${product} tagPattern needs a version group`,
      );
    }
  }
  return policy;
}

export function parseProductVersion(input) {
  if (typeof input !== 'string') return null;
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?$/
    .exec(input);
  if (!match) return null;
  return {
    raw: input,
    numbers: [
      Number.parseInt(match[1], 10),
      Number.parseInt(match[2], 10),
      Number.parseInt(match[3] ?? '0', 10),
    ],
    prerelease: match[4] ?? null,
  };
}

function prereleaseParts(value) {
  return value
    .split(/[.-]/)
    .flatMap((part) => part.split(/(?<=\D)(?=\d)|(?<=\d)(?=\D)/));
}

function comparePrerelease(left, right) {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;

  const leftParts = prereleaseParts(left);
  const rightParts = prereleaseParts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumber = /^\d+$/.test(leftPart);
    const rightNumber = /^\d+$/.test(rightPart);
    if (leftNumber && rightNumber) {
      return Number.parseInt(leftPart, 10) -
        Number.parseInt(rightPart, 10);
    }
    if (leftNumber !== rightNumber) return leftNumber ? -1 : 1;
    return leftPart.localeCompare(rightPart, 'en');
  }
  return 0;
}

export function compareProductVersions(left, right) {
  for (let index = 0; index < left.numbers.length; index += 1) {
    const difference = left.numbers[index] - right.numbers[index];
    if (difference !== 0) return difference;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

export function parseRemoteTagListing(output) {
  if (typeof output !== 'string') {
    throw new Error('Remote tag listing must be text');
  }
  const tags = new Map();
  for (const line of output.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (
      fields.length !== 2 ||
      !/^[0-9a-f]{40,64}$/i.test(fields[0])
    ) {
      continue;
    }
    const ref = fields[1];
    if (!ref.startsWith('refs/tags/')) continue;
    const peeled = ref.endsWith('^{}');
    const tag = ref
      .slice('refs/tags/'.length, peeled ? -3 : undefined);
    if (!tag) continue;

    const record = tags.get(tag) ?? {
      tag,
      direct: null,
      peeled: null,
    };
    const field = peeled ? 'peeled' : 'direct';
    if (record[field] && record[field] !== fields[0].toLowerCase()) {
      throw new Error(`Conflicting remote objects for tag ${tag}`);
    }
    record[field] = fields[0].toLowerCase();
    tags.set(tag, record);
  }
  return tags;
}

function indeterminate(product, reason, manifest = null) {
  return {
    product,
    state: 'indeterminate',
    reason,
    current: manifest
      ? {
          version: manifest.productVersion,
          ref: manifest.ref,
          commit: manifest.commit,
        }
      : null,
    latest: null,
  };
}

function candidateForTag(record, sourcePolicy) {
  if (!record.direct) return null;
  const match = new RegExp(sourcePolicy.tagPattern).exec(record.tag);
  const versionText = match?.groups?.version;
  const version = parseProductVersion(versionText);
  if (!version) return null;
  const eligible = sourcePolicy.channel === 'stable'
    ? version.prerelease === null
    : version.prerelease !== null;
  if (!eligible) return null;
  return {
    tag: record.tag,
    commit: record.peeled ?? record.direct,
    peeled: record.peeled !== null,
    version,
  };
}

export function evaluateSourceDrift({
  sourcePolicy,
  manifest,
  remoteTagListing,
}) {
  const product = sourcePolicy.product;
  if (
    manifest.product !== product ||
    manifest.visibility !== 'public' ||
    manifest.repository !== sourcePolicy.repository
  ) {
    return indeterminate(product, 'manifest-policy-mismatch', manifest);
  }
  if (manifest.channel !== sourcePolicy.channel) {
    return indeterminate(product, 'release-channel-mismatch', manifest);
  }

  const currentVersion = parseProductVersion(manifest.productVersion);
  if (!currentVersion) {
    return indeterminate(product, 'invalid-current-version', manifest);
  }

  let remoteTags;
  try {
    remoteTags = parseRemoteTagListing(remoteTagListing);
  } catch {
    return indeterminate(product, 'invalid-remote-tag-listing', manifest);
  }
  const currentRecord = remoteTags.get(manifest.ref);
  if (!currentRecord?.direct) {
    return indeterminate(product, 'current-tag-missing', manifest);
  }
  const currentCandidate = candidateForTag(
    currentRecord,
    sourcePolicy,
  );
  if (
    !currentCandidate ||
    compareProductVersions(currentCandidate.version, currentVersion) !== 0
  ) {
    return indeterminate(
      product,
      'current-tag-version-mismatch',
      manifest,
    );
  }
  if (currentCandidate.commit !== manifest.commit.toLowerCase()) {
    return indeterminate(
      product,
      'current-tag-commit-mismatch',
      manifest,
    );
  }

  const candidates = [ ...remoteTags.values() ]
    .map((record) => candidateForTag(record, sourcePolicy))
    .filter(Boolean)
    .sort((left, right) => {
      const versionOrder = compareProductVersions(
        left.version,
        right.version,
      );
      return versionOrder || left.tag.localeCompare(right.tag, 'en');
    });
  if (candidates.length === 0) {
    return indeterminate(product, 'no-eligible-tags', manifest);
  }

  const latest = candidates.at(-1);
  const equivalentLatest = candidates.filter(
    (candidate) =>
      compareProductVersions(candidate.version, latest.version) === 0,
  );
  if (
    new Set(equivalentLatest.map(({ commit }) => commit)).size !== 1
  ) {
    return indeterminate(
      product,
      'ambiguous-latest-version',
      manifest,
    );
  }

  const latestSummary = {
    version: latest.version.raw,
    ref: latest.tag,
    commit: latest.commit,
    peeled: latest.peeled,
  };
  const comparison = compareProductVersions(
    latest.version,
    currentVersion,
  );
  if (comparison < 0) {
    return indeterminate(
      product,
      'current-version-newer-than-policy-tags',
      manifest,
    );
  }
  if (comparison === 0) {
    if (latest.commit !== manifest.commit.toLowerCase()) {
      return indeterminate(
        product,
        'latest-tag-commit-mismatch',
        manifest,
      );
    }
    return {
      product,
      state: 'current',
      reason: 'pinned-latest-eligible-tag',
      current: {
        version: manifest.productVersion,
        ref: manifest.ref,
        commit: manifest.commit,
      },
      latest: latestSummary,
    };
  }
  return {
    product,
    state: 'update',
    reason: 'newer-eligible-tag',
    current: {
      version: manifest.productVersion,
      ref: manifest.ref,
      commit: manifest.commit,
    },
    latest: latestSummary,
  };
}

export function summarizeDriftResults(results) {
  const state = results.some(({ state: itemState }) =>
    itemState === 'indeterminate')
    ? 'indeterminate'
    : results.some(({ state: itemState }) => itemState === 'update')
      ? 'update'
      : 'current';
  return {
    schemaVersion: 1,
    state,
    sources: results,
  };
}

async function defaultReadJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function defaultRunGit(args) {
  return execFileAsync('git', args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

export async function queryGitTags(repository, runGit = defaultRunGit) {
  const result = await runGit([
    'ls-remote',
    '--tags',
    repository,
  ]);
  return typeof result === 'string' ? result : result.stdout;
}

export async function runPublicSourceDriftCheck({
  policyPath = defaultPolicyPath,
  readJson = defaultReadJson,
  listRemoteTags = queryGitTags,
} = {}) {
  const absolutePolicyPath = resolve(policyPath);
  const policy = validatePolicy(await readJson(absolutePolicyPath));
  const buildConfigPath = resolve(
    dirname(absolutePolicyPath),
    policy.buildConfig,
  );
  const buildConfig = objectValue(
    await readJson(buildConfigPath),
    'Public build config',
  );
  if (
    buildConfig.visibility !== 'public' ||
    !Array.isArray(buildConfig.sources)
  ) {
    throw new Error('Policy buildConfig must identify a public build');
  }

  const manifests = [];
  for (const entryInput of buildConfig.sources) {
    const entry = objectValue(entryInput, 'Public build source');
    const manifestPath = resolve(
      dirname(buildConfigPath),
      stringValue(entry.manifest, 'Public build source manifest'),
    );
    const manifest = objectValue(
      await readJson(manifestPath),
      `Public source manifest ${manifestPath}`,
    );
    if (manifest.visibility !== 'public') {
      throw new Error('Public build contains a non-public source');
    }
    manifests.push(manifest);
  }

  const policyProducts = new Set(
    policy.sources.map(({ product }) => product),
  );
  if (
    manifests.length !== policy.sources.length ||
    manifests.some(({ product }) => !policyProducts.has(product))
  ) {
    throw new Error('Maintenance policy does not cover the public build');
  }

  const results = [];
  for (const sourcePolicy of policy.sources) {
    const matches = manifests.filter(
      ({ product }) => product === sourcePolicy.product,
    );
    if (matches.length !== 1) {
      results.push(
        indeterminate(
          sourcePolicy.product,
          'public-manifest-not-unique',
        ),
      );
      continue;
    }

    let remoteTagListing;
    try {
      remoteTagListing = await listRemoteTags(sourcePolicy.repository);
    } catch {
      results.push(
        indeterminate(
          sourcePolicy.product,
          'remote-tag-query-failed',
          matches[0],
        ),
      );
      continue;
    }
    results.push(evaluateSourceDrift({
      sourcePolicy,
      manifest: matches[0],
      remoteTagListing,
    }));
  }
  return summarizeDriftResults(results);
}

function parseArguments(args) {
  if (args.length === 0) return { policyPath: defaultPolicyPath };
  if (args.length === 1 && args[0] === '--help') return { help: true };
  if (args.length === 2 && args[0] === '--policy') {
    return { policyPath: args[1] };
  }
  throw new Error('Usage: check-public-source-drift.mjs [--policy PATH]');
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      'Usage: check-public-source-drift.mjs [--policy PATH]\n',
    );
    return;
  }
  try {
    const report = await runPublicSourceDriftCheck({
      policyPath: args.policyPath,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = EXIT_CODES[report.state];
  } catch {
    const report = {
      schemaVersion: 1,
      state: 'indeterminate',
      reason: 'configuration-or-execution-error',
      sources: [],
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = EXIT_CODES.indeterminate;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  await main();
}
