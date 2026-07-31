import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  createCapturePlan,
  runCapture,
} from './capture-wp-env-profile.mjs';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
);
const probePath = join(
  repositoryRoot,
  'probes/php/wp-block-catalog-probe.php',
);
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function fixture() {
  const root = await mkdtemp(
    join(tmpdir(), 'wp-block-catalog-capture-test-'),
  );
  const configPath = join(root, '.wp-env.jetpack.json');
  const profilePath = join(root, 'profile.json');
  const environmentPath = join(root, 'environment.json');
  const outputDirectory = join(root, 'capture');
  const profile = {
    productVersions: {
      wordpress: '7.0.2',
      jetpack: '16.0.1',
    },
    locale: 'en_US',
    theme: {
      kind: 'block',
      slug: 'twentytwentyfive',
    },
    featureFlags: {
      connection: 'disconnected',
      offlineMode: true,
      blocksModule: true,
      variation: 'production',
    },
  };
  const environment = {
    id: 'wordpress@7.0.2+jetpack@16.0.1',
    title: 'WordPress with Jetpack, disconnected',
    visibility: 'public',
    layers: [
      { sourceId: 'wordpress@7.0.2', priority: 100 },
      { sourceId: 'jetpack@16.0.1', priority: 200 },
    ],
    metadata: {
      wordpressVersion: '7.0.2',
      jetpackVersion: '16.0.1',
      editorSurface: 'post-editor',
      themeType: 'block',
      featureFlags: profile.featureFlags,
      locale: 'en_US',
    },
  };
  const config = {
    core: 'WordPress/WordPress#7.0.2',
    port: 8901,
    phpVersion: '8.3',
    testsEnvironment: false,
    plugins: [
      'https://downloads.wordpress.org/plugin/jetpack.16.0.1.zip',
    ],
    mappings: {
      'wp-content/mu-plugins/wp-block-catalog-probe.php': probePath,
    },
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
  await writeFile(
    environmentPath,
    `${JSON.stringify(environment, null, 2)}\n`,
  );
  return {
    root,
    configPath,
    profilePath,
    environmentPath,
    outputDirectory,
    profile,
  };
}

function options(files) {
  return {
    ...files,
    wpEnvBin: 'fake-wp-env',
    browserModule: 'fake-playwright',
    timeoutMs: 10_000,
    adminUserEnv: 'TEST_CAPTURE_USER',
    adminPasswordEnv: 'TEST_CAPTURE_PASSWORD',
    adminUser: 'admin',
    adminPassword: 'password',
  };
}

function rawSnapshot(kind, plan) {
  const blocks = [
    {
      name: 'core/paragraph',
      attributes: {},
      supports: {},
    },
  ];
  const snapshot = {
    schemaVersion: 1,
    kind,
    environmentId: plan.environmentId,
    editorSurface:
      kind === 'client' ? 'core/edit-post' : undefined,
    profile: plan.captureProfile,
    profileHash: sha256(JSON.stringify(plan.captureProfile)),
    capturedAt: '2026-07-30T00:00:00Z',
    registryHash: sha256(JSON.stringify(blocks)),
    blocks,
  };
  if (kind === 'server') {
    snapshot.phpVersion = '8.3.32';
    snapshot.timezone = '+00:00';
  }
  return snapshot;
}

function fakeBrowser(plan) {
  let currentUrl = `${plan.browserBaseUrl}/wp-login.php`;
  const page = {
    async goto(url) {
      currentUrl = url;
    },
    locator(selector) {
      return {
        async fill() {},
        async click() {
          if (selector === '#wp-submit') {
            currentUrl = `${plan.browserBaseUrl}/wp-admin/`;
          }
        },
      };
    },
    async waitForURL() {},
    async waitForLoadState() {},
    url() {
      return currentUrl;
    },
    async waitForSelector() {},
    async waitForFunction() {},
    async addScriptTag() {},
    async evaluate() {
      const markup =
        '<!-- wp:paragraph --><p>Test</p><!-- /wp:paragraph -->';
      return {
        snapshot: rawSnapshot('client', plan),
        staticProbe: {
          kind: 'static-save',
          name: 'core/paragraph',
          attributes: { content: 'Jetpack disconnected runtime' },
          markup,
          markupHash: sha256(markup),
          parsedBlockCount: 1,
          valid: true,
          issues: [],
        },
      };
    },
  };
  return {
    chromium: {
      async launch() {
        return {
          async newContext() {
            return {
              async newPage() {
                return page;
              },
              async close() {},
            };
          },
          async close() {},
        };
      },
    },
  };
}

test('validates and captures a disconnected public profile without network', async (t) => {
  const files = await fixture();
  t.after(async () => rm(files.root, { recursive: true, force: true }));
  const captureOptions = options(files);
  const plan = await createCapturePlan(captureOptions);
  const commands = [];
  let startAttempts = 0;

  const result = await runCapture(captureOptions, {
    async loadBrowserDriver() {
      return fakeBrowser(plan);
    },
    async runCommand(command, args, commandOptions) {
      commands.push({ command, args });
      if (args[0] === 'start') {
        startAttempts += 1;
        if (startAttempts === 1) {
          const stateDirectory = join(
            commandOptions.env.WP_ENV_HOME,
            'test-state',
          );
          await mkdir(stateDirectory, { recursive: true });
          await writeFile(
            join(stateDirectory, 'docker-compose.yml'),
            'services: {}\n',
          );
          await writeFile(
            join(stateDirectory, 'wp-env-cache.json'),
            '{}\n',
          );
          throw new Error(
            "Could not process wp-config.php: it is not writable",
          );
        }
      }
      if (args.includes('--field=version')) {
        return { stdout: '16.0.1\n', stderr: '' };
      }
      if (args.includes('snapshot')) {
        const configPath = args[args.indexOf('--config') + 1];
        const config = JSON.parse(await readFile(configPath, 'utf8'));
        const output = Object.entries(config.mappings).find(
          ([ mappedPath ]) => mappedPath.endsWith('.server.raw.json'),
        )?.[1];
        assert.ok(output);
        await writeFile(
          output,
          `${JSON.stringify(rawSnapshot('server', plan), null, 2)}\n`,
        );
      }
      return { stdout: '', stderr: '' };
    },
  });

  assert.equal(result.outputDirectory, files.outputDirectory);
  assert.deepEqual(
    (await readdir(files.outputDirectory)).sort(),
    [
      plan.clientFilename,
      plan.serverFilename,
      plan.staticFilename,
    ].sort(),
  );
  assert.ok(commands.some(({ args }) => args[0] === 'start'));
  assert.equal(startAttempts, 2);
  assert.ok(commands.some(
    ({ command, args }) =>
      command === 'docker' &&
      args.includes('/var/www/html/wp-config.php'),
  ));
  assert.ok(commands.every(({ args }) => !args.includes('--update')));
  assert.ok(commands.some(({ args }) => args.includes('snapshot')));
  assert.ok(commands.some(({ args }) => args[0] === 'destroy'));
  assert.ok(commands.every(
    ({ command }) => [ 'fake-wp-env', 'docker' ].includes(command),
  ));
});

test('fails before wp-env when browser support is unavailable', async (t) => {
  const files = await fixture();
  t.after(async () => rm(files.root, { recursive: true, force: true }));
  let commandCount = 0;

  await assert.rejects(
    runCapture(options(files), {
      async loadBrowserDriver() {
        throw new Error('Playwright is unavailable');
      },
      async runCommand() {
        commandCount += 1;
        return { stdout: '', stderr: '' };
      },
    }),
    /Playwright is unavailable/,
  );
  assert.equal(commandCount, 0);
  await assert.rejects(
    readFile(files.outputDirectory),
    /ENOENT|EISDIR/,
  );
});

test('rejects profile drift before starting capture', async (t) => {
  const files = await fixture();
  t.after(async () => rm(files.root, { recursive: true, force: true }));
  const changedProfile = {
    ...files.profile,
    featureFlags: {
      ...files.profile.featureFlags,
      connection: 'connected',
      offlineMode: false,
    },
  };
  await writeFile(
    files.profilePath,
    `${JSON.stringify(changedProfile, null, 2)}\n`,
  );

  await assert.rejects(
    createCapturePlan(options(files)),
    /feature flags does not match|Profile must be disconnected/,
  );
});
