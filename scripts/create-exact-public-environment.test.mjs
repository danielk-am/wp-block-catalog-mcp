import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createExactPublicEnvironment,
} from './create-exact-public-environment.mjs';

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value)}\n`);
  return path;
}

test('creates a sealed exact public environment from normalized evidence',
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'exact-environment-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(root, { recursive: true });
    const id = 'wordpress@7.0.2+jetpack@16.0.1';
    const profile = {
      environmentId: id,
      productVersions: {
        wordpress: '7.0.2',
        jetpack: '16.0.1',
      },
      editorSurface: 'core/edit-post',
      locale: 'en_US',
      theme: { kind: 'block', slug: 'twentytwentyfive' },
      featureFlags: {
        connection: 'disconnected',
        offlineMode: true,
      },
    };
    const paths = {
      environmentPath: await writeJson(join(root, 'environment.json'), {
        id,
        visibility: 'public',
        metadata: {
          wordpressVersion: '7.0.2',
          jetpackVersion: '16.0.1',
          locale: 'en_US',
        },
      }),
      wordpressSourcePath: await writeJson(join(root, 'wordpress.json'), {
        id: 'wordpress@7.0.2',
        product: 'wordpress',
        productVersion: '7.0.2',
        visibility: 'public',
        commit: '1'.repeat(40),
      }),
      productSourcePath: await writeJson(join(root, 'jetpack.json'), {
        id: 'jetpack@16.0.1',
        product: 'jetpack',
        productVersion: '16.0.1',
        visibility: 'public',
        commit: '2'.repeat(40),
      }),
      serverRawPath: await writeJson(join(root, 'server.raw.json'), {
        environmentId: id,
        phpVersion: '8.3.32',
        timezone: '+00:00',
      }),
      serverPath: await writeJson(join(root, 'server.json'), {
        kind: 'server',
        profile,
        profileHash: '3'.repeat(64),
        registryHash: '4'.repeat(64),
      }),
      clientPath: await writeJson(join(root, 'client.json'), {
        kind: 'client',
        profile,
        profileHash: '3'.repeat(64),
        registryHash: '5'.repeat(64),
      }),
    };

    const exact = await createExactPublicEnvironment(paths);

    assert.equal(exact.id, id);
    assert.equal(exact.phpVersion, '8.3.32');
    assert.equal(exact.runtimeComponents[0]?.artifactHash, '4'.repeat(64));
    assert.equal(exact.runtimeComponents[1]?.artifactHash, '5'.repeat(64));
  });
