#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';

import {
  evaluateSourceDrift,
  parseRemoteTagListing,
  queryGitTags,
  runPublicSourceDriftCheck,
  summarizeDriftResults,
} from './check-public-source-drift.mjs';

const oid = (character) => character.repeat(40);

function sourcePolicy(overrides = {}) {
  return {
    product: 'example',
    repository: 'https://github.com/example/public',
    channel: 'stable',
    discovery: {
      kind: 'git-tags',
      branchFallback: false,
    },
    tagPattern:
      '^v(?<version>[0-9]+\\.[0-9]+\\.[0-9]+' +
      '(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?)$',
    ...overrides,
  };
}

function manifest(overrides = {}) {
  return {
    id: 'example@1.0.0',
    product: 'example',
    productVersion: '1.0.0',
    channel: 'stable',
    visibility: 'public',
    repository: 'https://github.com/example/public',
    ref: 'v1.0.0',
    commit: oid('a'),
    ...overrides,
  };
}

function tagLine(commit, tag, peeled = false) {
  return `${commit}\trefs/tags/${tag}${peeled ? '^{}' : ''}`;
}

test('peels annotated tags before comparing immutable commits', () => {
  const listing = [
    tagLine(oid('b'), 'v1.0.0'),
    tagLine(oid('a'), 'v1.0.0', true),
  ].join('\n');
  const tags = parseRemoteTagListing(listing);
  assert.equal(tags.get('v1.0.0')?.direct, oid('b'));
  assert.equal(tags.get('v1.0.0')?.peeled, oid('a'));

  const result = evaluateSourceDrift({
    sourcePolicy: sourcePolicy(),
    manifest: manifest(),
    remoteTagListing: listing,
  });
  assert.equal(result.state, 'current');
  assert.equal(result.latest.commit, oid('a'));
  assert.equal(result.latest.peeled, true);
});

test('stable policy ignores newer prerelease tags', () => {
  const listing = [
    tagLine(oid('a'), 'v1.0.0'),
    tagLine(oid('b'), 'v1.0.1'),
    tagLine(oid('c'), 'v1.1.0-beta.1'),
  ].join('\n');
  const result = evaluateSourceDrift({
    sourcePolicy: sourcePolicy(),
    manifest: manifest(),
    remoteTagListing: listing,
  });
  assert.equal(result.state, 'update');
  assert.equal(result.latest.version, '1.0.1');
  assert.equal(result.latest.ref, 'v1.0.1');
});

test('prerelease policy ignores stable tags and orders prereleases', () => {
  const listing = [
    tagLine(oid('a'), 'v1.1.0-beta.1'),
    tagLine(oid('b'), 'v1.1.0-beta.2'),
    tagLine(oid('c'), 'v1.1.0'),
  ].join('\n');
  const result = evaluateSourceDrift({
    sourcePolicy: sourcePolicy({ channel: 'prerelease' }),
    manifest: manifest({
      id: 'example@1.1.0-beta.1',
      productVersion: '1.1.0-beta.1',
      channel: 'prerelease',
      ref: 'v1.1.0-beta.1',
    }),
    remoteTagListing: listing,
  });
  assert.equal(result.state, 'update');
  assert.equal(result.latest.version, '1.1.0-beta.2');
});

test('returns indeterminate when current tag does not prove the pin', () => {
  const result = evaluateSourceDrift({
    sourcePolicy: sourcePolicy(),
    manifest: manifest(),
    remoteTagListing: tagLine(oid('b'), 'v1.0.0'),
  });
  assert.equal(result.state, 'indeterminate');
  assert.equal(result.reason, 'current-tag-commit-mismatch');
});

test('never treats a branch as a release fallback', async () => {
  const branchOnly = `${oid('a')}\trefs/heads/main\n`;
  const result = evaluateSourceDrift({
    sourcePolicy: sourcePolicy(),
    manifest: manifest(),
    remoteTagListing: branchOnly,
  });
  assert.equal(result.state, 'indeterminate');
  assert.equal(result.reason, 'current-tag-missing');

  const calls = [];
  const output = await queryGitTags(
    'https://github.com/example/public',
    async (args) => {
      calls.push(args);
      return { stdout: branchOnly };
    },
  );
  assert.equal(output, branchOnly);
  assert.deepEqual(calls, [ [
    'ls-remote',
    '--tags',
    'https://github.com/example/public',
  ] ]);
  assert.equal(calls[0].includes('--heads'), false);
});

test('summarizes current, update, and indeterminate states safely', () => {
  assert.equal(summarizeDriftResults([
    { state: 'current' },
  ]).state, 'current');
  assert.equal(summarizeDriftResults([
    { state: 'current' },
    { state: 'update' },
  ]).state, 'update');
  assert.equal(summarizeDriftResults([
    { state: 'update' },
    { state: 'indeterminate' },
  ]).state, 'indeterminate');
});

test('runs entirely from injected fixtures without network access', async () => {
  const policyPath = '/fixture/policies/public-source-maintenance.json';
  const buildPath = '/fixture/build/public.json';
  const manifestPath = '/fixture/sources/example.json';
  const fixtures = new Map([
    [ resolve(policyPath), {
      schemaVersion: 1,
      buildConfig: '../build/public.json',
      sources: [ sourcePolicy() ],
    } ],
    [ resolve(buildPath), {
      visibility: 'public',
      sources: [ { manifest: '../sources/example.json' } ],
    } ],
    [ resolve(manifestPath), manifest() ],
  ]);
  const repositories = [];

  const report = await runPublicSourceDriftCheck({
    policyPath,
    readJson: async (path) => {
      assert.ok(fixtures.has(path), `Unexpected fixture read ${path}`);
      return structuredClone(fixtures.get(path));
    },
    listRemoteTags: async (repository) => {
      repositories.push(repository);
      return tagLine(oid('a'), 'v1.0.0');
    },
  });

  assert.equal(report.state, 'current');
  assert.deepEqual(repositories, [
    'https://github.com/example/public',
  ]);
});
