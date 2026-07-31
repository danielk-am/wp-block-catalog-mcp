import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  access,
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { buildCatalog } from '../dist/build.js';
import { prepareDeliveryArtifact } from '../dist/delivery/index.js';

import {
  assertMatchingArtifact,
  verifyOne,
} from './verify-catalog-build.mjs';

const execFileAsync = promisify(execFile);

const artifact = {
  schemaVersion: 1,
  catalogVersion: 'test',
  generatedAt: '2026-07-30T00:00:00.000Z',
  sources: [],
  environments: [],
  blocks: [],
};

test('rebuild comparison ignores time but rejects content drift', () => {
  assert.doesNotThrow(() => assertMatchingArtifact(
    artifact,
    {
      ...artifact,
      generatedAt: '2026-07-30T01:00:00.000Z',
    },
    'test catalogue',
  ));
  assert.throws(
    () => assertMatchingArtifact(
      artifact,
      {
        ...artifact,
        catalogVersion: 'changed',
      },
      'test catalogue',
    ),
    /does not match its deterministic source build/,
  );
});

test('rebuild verification works without ignored generated artefacts',
  async () => {
    const temporary = await mkdtemp(
      join(tmpdir(), 'wp-block-catalog-clean-rebuild-'),
    );
    try {
      const checkoutPath = join(temporary, 'checkout');
      const blockDirectory = join(checkoutPath, 'blocks', 'example');
      const manifestPath = join(temporary, 'source.json');
      const missingOutput = join(temporary, 'missing.generated.json');
      const seedOutput = join(temporary, 'seed.generated.json');
      const seedConfigPath = join(temporary, 'seed.json');
      const configPath = join(temporary, 'public.json');
      const releasePath = join(temporary, 'public.release.json');

      await mkdir(blockDirectory, { recursive: true });
      await writeFile(
        join(blockDirectory, 'block.json'),
        `${JSON.stringify({
          apiVersion: 3,
          name: 'fixture/example',
          title: 'Example',
          category: 'text',
        }, null, 2)}\n`,
      );
      await execFileAsync('git', [ 'init', checkoutPath ]);
      await execFileAsync('git', [ '-C', checkoutPath, 'add', '.' ]);
      await execFileAsync(
        'git',
        [
          '-C',
          checkoutPath,
          '-c',
          'user.name=Catalogue Test',
          '-c',
          'user.email=catalogue-test@example.invalid',
          '-c',
          'commit.gpgsign=false',
          'commit',
          '-m',
          'Add fixture block',
        ],
      );
      const { stdout: fixtureCommit } = await execFileAsync(
        'git',
        [ '-C', checkoutPath, 'rev-parse', 'HEAD' ],
        { encoding: 'utf8' },
      );
      await writeFile(
        manifestPath,
        `${JSON.stringify({
          id: 'fixture@1.0.0',
          adapter: 'fixture',
          product: 'fixture',
          productVersion: '1.0.0',
          channel: 'stable',
          visibility: 'public',
          repository: 'https://example.invalid/fixture',
          ref: 'v1.0.0',
          commit: fixtureCommit.trim(),
          include: [ 'blocks/*/block.json' ],
          exclude: [],
          metadata: {},
        }, null, 2)}\n`,
      );
      const sharedConfig = {
        catalogVersion: 'test',
        visibility: 'public',
        sources: [
          {
            manifest: manifestPath,
            checkout: checkoutPath,
          },
        ],
        environments: [
          {
            id: 'fixture@1.0.0',
            title: 'Fixture',
            visibility: 'public',
            layers: [
              {
                sourceId: 'fixture@1.0.0',
                priority: 100,
              },
            ],
            metadata: {},
          },
        ],
        environmentFiles: [],
      };
      await writeFile(
        configPath,
        `${JSON.stringify({
          ...sharedConfig,
          output: missingOutput,
        }, null, 2)}\n`,
      );
      await writeFile(
        seedConfigPath,
        `${JSON.stringify({
          ...sharedConfig,
          output: seedOutput,
        }, null, 2)}\n`,
      );
      const seed = await buildCatalog(seedConfigPath);
      await writeFile(
        releasePath,
        `${JSON.stringify(
          prepareDeliveryArtifact(seed, 'public'),
          null,
          2,
        )}\n`,
      );

      await assert.rejects(access(missingOutput));
      const result = await verifyOne({
        visibility: 'public',
        configPath,
        releasePath,
        temporary,
      });
      assert.equal(result.passed, true);
      assert.equal(result.counts.definitions, 1);
      await assert.rejects(access(missingOutput));
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
