import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { gateRelease } from './gate-release.mjs';

const releaseArtifact = JSON.parse(await readFile(
  resolve('catalog/public.release.generated.json'),
  'utf8',
));
const captureTime = new Date(releaseArtifact.generatedAt);

test('release gate accepts an explicit unchanged public baseline',
  async () => {
    const result = await gateRelease(
      resolve('catalog/public.release.generated.json'),
      { now: captureTime },
    );

    assert.equal(result.passed, true);
    assert.equal(result.public.unexplainedRemovalCount, 0);
    assert.equal(Object.hasOwn(result.public, 'unexplainedRemovals'), false);
  });

test('release gate checks a distinct candidate without printing inventory',
  async () => {
    const temporary = await mkdtemp(
      join(tmpdir(), 'wp-block-catalog-release-gate-'),
    );
    try {
      const publicPath = resolve(
        'catalog/public.release.generated.json',
      );
      const publicArtifact = JSON.parse(
        await readFile(publicPath, 'utf8'),
      );
      const removedDefinition = publicArtifact.blocks[0].id;
      const removedName = publicArtifact.blocks[0].name;
      const candidate = {
        ...publicArtifact,
        blocks: publicArtifact.blocks.slice(1),
      };
      const candidatePath = join(temporary, 'public-candidate.json');
      const unexplainedPolicyPath = join(
        temporary,
        'public-unexplained-policy.json',
      );
      const explainedPolicyPath = join(
        temporary,
        'public-explained-policy.json',
      );
      await writeFile(
        candidatePath,
        `${JSON.stringify(candidate)}\n`,
      );
      await writeFile(
        unexplainedPolicyPath,
        `${JSON.stringify({
          visibility: 'public',
          freshness: {
            maxAgeSeconds: 604800,
            maxFutureSkewSeconds: 300,
          },
          removalExplanations: [],
        })}\n`,
      );
      await writeFile(
        explainedPolicyPath,
        `${JSON.stringify({
          visibility: 'public',
          freshness: {
            maxAgeSeconds: 604800,
            maxFutureSkewSeconds: 300,
          },
          removalExplanations: [
            {
              kind: 'definition',
              key: removedDefinition,
              reason: 'Intentional test removal.',
            },
          ],
        })}\n`,
      );

      const options = {
        publicPolicyPath: unexplainedPolicyPath,
        publicNextPath: candidatePath,
        now: captureTime,
      };
      const failed = await gateRelease(
        publicPath,
        options,
      );
      assert.equal(failed.passed, false);
      assert.equal(failed.public.unexplainedRemovalCount, 1);
      assert.equal(
        JSON.stringify(failed).includes(removedDefinition),
        false,
      );
      assert.equal(
        JSON.stringify(failed).includes(removedName),
        false,
      );

      const passed = await gateRelease(
        publicPath,
        {
          ...options,
          publicPolicyPath: explainedPolicyPath,
        },
      );
      assert.equal(passed.passed, true);
      assert.equal(passed.public.unexplainedRemovalCount, 0);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

test('release gate rejects a snapshot after the freshness window', async () => {
  const result = await gateRelease(
    resolve('catalog/public.release.generated.json'),
    { now: new Date(captureTime.getTime() + 8 * 24 * 60 * 60 * 1000) },
  );
  assert.equal(result.passed, false);
  assert.equal(result.public.freshness, 'stale');
});
