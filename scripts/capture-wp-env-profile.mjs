#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), '..');
const phpProbePath = join(
  repositoryRoot,
  'probes/php/wp-block-catalog-probe.php',
);
const browserProbePath = join(
  repositoryRoot,
  'probes/browser/client-probe.js',
);
const mappedProbePath =
  'wp-content/mu-plugins/wp-block-catalog-probe.php';
const mappedProfilePath =
  'wp-content/mu-plugins/wp-block-catalog-profile.json';
const sha256Pattern = /^[0-9a-f]{64}$/;

function usage() {
  return [
    'Usage:',
    '  node scripts/capture-wp-env-profile.mjs \\',
    '    --config <.wp-env.jetpack.json> \\',
    '    --profile <profile.json> \\',
    '    --environment <environment.json> \\',
    '    --output-dir <new-directory>',
    '',
    'Options:',
    '  --wp-env-bin <path>          Defaults to local node_modules/.bin/wp-env',
    '  --docker-bin <path>          Defaults to docker',
    '  --browser-module <specifier> Defaults to playwright',
    '  --browser-url <url>          Defaults to the configured localhost port',
    '  --timeout-ms <milliseconds>  Defaults to 300000',
    '  --admin-user-env <name>      Defaults to WP_BLOCK_CATALOG_ADMIN_USER',
    '  --admin-password-env <name>  Defaults to WP_BLOCK_CATALOG_ADMIN_PASSWORD',
    '',
    'The output directory must not exist. Browser credentials are read only',
    'from environment variables and are removed from wp-env child processes.',
  ].join('\n');
}

function fail(message) {
  throw new Error(message);
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be a JSON object`);
  }
  return value;
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${label} must be a non-empty string`);
  }
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([ left ], [ right ]) => left.localeCompare(right))
        .map(([ key, item ]) => [ key, canonical(item) ]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertSame(left, right, label) {
  if (canonicalJson(left) !== canonicalJson(right)) {
    fail(`${label} does not match the documented profile`);
  }
}

async function readJson(path, label) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    fail(`${label} is not readable: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function parseArgs(argv) {
  const values = {};
  if (argv.includes('--help') || argv.includes('-h')) {
    return { help: true };
  }
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      fail(`Invalid arguments\n\n${usage()}`);
    }
    const name = key.slice(2);
    if (Object.hasOwn(values, name)) {
      fail(`Duplicate option ${key}`);
    }
    values[name] = value;
  }
  const allowed = new Set([
    'config',
    'profile',
    'environment',
    'output-dir',
    'wp-env-bin',
    'docker-bin',
    'browser-module',
    'browser-url',
    'timeout-ms',
    'admin-user-env',
    'admin-password-env',
  ]);
  for (const name of Object.keys(values)) {
    if (!allowed.has(name)) {
      fail(`Unknown option --${name}`);
    }
  }
  for (const name of [ 'config', 'profile', 'environment', 'output-dir' ]) {
    if (!values[name]) {
      fail(`Missing --${name}\n\n${usage()}`);
    }
  }
  const timeoutMs = Number(values['timeout-ms'] ?? 300_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000) {
    fail('--timeout-ms must be an integer of at least 1000');
  }
  return {
    configPath: resolve(values.config),
    profilePath: resolve(values.profile),
    environmentPath: resolve(values.environment),
    outputDirectory: resolve(values['output-dir']),
    wpEnvBin:
      values['wp-env-bin'] ??
      join(repositoryRoot, 'node_modules/.bin/wp-env'),
    dockerBin: values['docker-bin'] ?? 'docker',
    browserModule: values['browser-module'] ?? 'playwright',
    browserUrl: values['browser-url'],
    timeoutMs,
    adminUserEnv:
      values['admin-user-env'] ?? 'WP_BLOCK_CATALOG_ADMIN_USER',
    adminPasswordEnv:
      values['admin-password-env'] ??
      'WP_BLOCK_CATALOG_ADMIN_PASSWORD',
  };
}

function safeOutputDirectory(path) {
  const resolved = resolve(path);
  if (
    resolved === '/' ||
    resolved === homedir() ||
    resolved === repositoryRoot ||
    basename(resolved) === '.' ||
    basename(resolved) === '..'
  ) {
    fail(`Unsafe output directory: ${resolved}`);
  }
  return resolved;
}

function resolveMapping(configPath, mapping) {
  return resolve(dirname(configPath), mapping);
}

export async function createCapturePlan(options) {
  const configPath = resolve(options.configPath);
  const profilePath = resolve(options.profilePath);
  const environmentPath = resolve(options.environmentPath);
  const outputDirectory = safeOutputDirectory(options.outputDirectory);
  const config = object(
    await readJson(configPath, 'wp-env config'),
    'wp-env config',
  );
  const profile = object(
    await readJson(profilePath, 'runtime profile'),
    'runtime profile',
  );
  const environment = object(
    await readJson(environmentPath, 'catalogue environment'),
    'catalogue environment',
  );

  if (environment.visibility !== 'public') {
    fail('Only public catalogue environments can be captured');
  }
  const profileVersions = object(
    profile.productVersions,
    'profile.productVersions',
  );
  const wordpressVersion = nonEmptyString(
    profileVersions.wordpress,
    'profile.productVersions.wordpress',
  );
  const jetpackVersion = nonEmptyString(
    profileVersions.jetpack,
    'profile.productVersions.jetpack',
  );
  const environmentId =
    `wordpress@${wordpressVersion}+jetpack@${jetpackVersion}`;
  if (environment.id !== environmentId) {
    fail(`Environment ID must be ${environmentId}`);
  }
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(wordpressVersion)) {
    fail('WordPress version must be a stable numeric release');
  }
  if (!/^\d+\.\d+\.\d+$/.test(jetpackVersion)) {
    fail('Jetpack version must be a stable numeric release');
  }

  const expectedCore = `WordPress/WordPress#${wordpressVersion}`;
  if (config.core !== expectedCore) {
    fail(`wp-env core must be ${expectedCore}`);
  }
  if (config.testsEnvironment !== false) {
    fail('wp-env testsEnvironment must be false');
  }
  if (
    !Number.isInteger(config.port) ||
    config.port < 1 ||
    config.port > 65_535
  ) {
    fail('wp-env port must be an integer from 1 to 65535');
  }

  const plugins = Array.isArray(config.plugins) ? config.plugins : [];
  const expectedPlugin =
    `https://downloads.wordpress.org/plugin/jetpack.${jetpackVersion}.zip`;
  if (plugins.length !== 1 || plugins[0] !== expectedPlugin) {
    fail(`wp-env plugins must contain only ${expectedPlugin}`);
  }

  const mappings = object(config.mappings, 'wp-env mappings');
  const configuredProbe = nonEmptyString(
    mappings[mappedProbePath],
    `wp-env mapping ${mappedProbePath}`,
  );
  if (
    resolveMapping(configPath, configuredProbe) !== resolve(phpProbePath)
  ) {
    fail('wp-env PHP probe mapping does not resolve to the repository probe');
  }
  await access(phpProbePath, fsConstants.R_OK);
  await access(browserProbePath, fsConstants.R_OK);

  const metadata = object(environment.metadata, 'environment.metadata');
  if (metadata.wordpressVersion !== wordpressVersion) {
    fail('Environment WordPress version does not match profile');
  }
  if (metadata.jetpackVersion !== jetpackVersion) {
    fail('Environment Jetpack version does not match profile');
  }
  if (metadata.locale !== profile.locale) {
    fail('Environment locale does not match profile');
  }
  if (metadata.themeType !== profile.theme?.kind) {
    fail('Environment theme type does not match profile');
  }
  assertSame(
    metadata.featureFlags,
    profile.featureFlags,
    'Environment feature flags',
  );
  const flags = object(profile.featureFlags, 'profile.featureFlags');
  if (
    flags.connection !== 'disconnected' ||
    flags.offlineMode !== true ||
    flags.blocksModule !== true ||
    flags.variation !== 'production'
  ) {
    fail(
      'Profile must be disconnected, offline, blocks-enabled production',
    );
  }

  const layers = Array.isArray(environment.layers)
    ? environment.layers
    : [];
  const sourceIds = new Set(
    layers.map((layer) => object(layer, 'environment layer').sourceId),
  );
  for (const sourceId of [
    `wordpress@${wordpressVersion}`,
    `jetpack@${jetpackVersion}`,
  ]) {
    if (!sourceIds.has(sourceId)) {
      fail(`Environment is missing source layer ${sourceId}`);
    }
  }

  if (await exists(outputDirectory)) {
    fail(`Output directory already exists: ${outputDirectory}`);
  }

  const captureProfile = canonical({
    ...profile,
    environmentId,
    editorSurface: 'core/edit-post',
  });
  const outputBase =
    `wordpress-${wordpressVersion}-jetpack-${jetpackVersion}` +
    '-disconnected-post-editor';
  const browserBaseUrl =
    options.browserUrl ?? `http://localhost:${config.port}`;
  const parsedBrowserUrl = new URL(browserBaseUrl);
  if (
    ![ 'localhost', '127.0.0.1', '::1' ].includes(
      parsedBrowserUrl.hostname,
    ) ||
    parsedBrowserUrl.protocol !== 'http:'
  ) {
    fail('Browser URL must be an HTTP loopback URL');
  }

  return {
    config,
    configPath,
    profile,
    profilePath,
    environment,
    environmentPath,
    environmentId,
    wordpressVersion,
    jetpackVersion,
    expectedPlugin,
    captureProfile,
    browserBaseUrl: parsedBrowserUrl.origin,
    outputBase,
    outputDirectory,
    serverFilename: `${outputBase}.server.raw.json`,
    clientFilename: `${outputBase}.client.raw.json`,
    staticFilename:
      `wordpress-${wordpressVersion}-jetpack-${jetpackVersion}` +
      '-disconnected-core-paragraph.static.raw.json',
  };
}

function withoutBrowserCredentials(environment) {
  const childEnvironment = { ...environment };
  delete childEnvironment.WP_BLOCK_CATALOG_ADMIN_USER;
  delete childEnvironment.WP_BLOCK_CATALOG_ADMIN_PASSWORD;
  return childEnvironment;
}

export function runProcess(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: options.env,
      stdio: [ 'ignore', 'pipe', 'pipe' ],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    }, options.timeoutMs ?? 300_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) {
        resolvePromise({ stdout, stderr });
        return;
      }
      const detail = stderr.trim() || stdout.trim() || 'no command output';
      rejectPromise(
        new Error(
          timedOut
            ? `${command} timed out`
            : `${command} exited ${code ?? signal}: ${detail}`,
        ),
      );
    });
  });
}

async function findNamedFiles(root, filename) {
  const matches = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && entry.name === filename) {
        matches.push(entryPath);
      }
    }
  }
  await visit(root);
  return matches.sort();
}

async function findProjectComposeFile(wpEnvHome) {
  const composeFiles = await findNamedFiles(
    wpEnvHome,
    'docker-compose.yml',
  );
  const projectComposeFiles = [];
  for (const composeFile of composeFiles) {
    if (await exists(join(dirname(composeFile), 'wp-env-cache.json'))) {
      projectComposeFiles.push(composeFile);
    }
  }
  if (projectComposeFiles.length !== 1) {
    fail(
      'The isolated wp-env Docker Compose project could not be ' +
      'identified uniquely',
    );
  }
  return projectComposeFiles[0];
}

async function startWpEnv(options, wpEnvHome, runCommand, commandOptions) {
  const startArguments = [
    'start',
    '--config',
    options.temporaryConfigPath,
    '--runtime=docker',
  ];
  try {
    await runCommand(
      options.wpEnvBin,
      startArguments,
      commandOptions,
    );
    return;
  } catch (error) {
    if (!/wp-config\.php[\s\S]*not writable/i.test(error.message)) {
      throw error;
    }
  }

  const composeFile = await findProjectComposeFile(wpEnvHome);
  await runCommand(
    options.dockerBin ?? 'docker',
    [
      'compose',
      '-f',
      composeFile,
      'run',
      '--rm',
      '--user',
      'root',
      'cli',
      'chmod',
      '0666',
      '/var/www/html/wp-config.php',
    ],
    commandOptions,
  );
  await runCommand(
    options.wpEnvBin,
    startArguments,
    commandOptions,
  );
}

async function restoreWpEnvOwnership(
  options,
  wpEnvHome,
  runCommand,
  commandOptions,
) {
  if (typeof process.getuid !== 'function' ||
    typeof process.getgid !== 'function') {
    fail('wp-env cleanup requires POSIX user and group IDs');
  }
  const composeFile = await findProjectComposeFile(wpEnvHome);
  await runCommand(
    options.dockerBin ?? 'docker',
    [
      'compose',
      '-f',
      composeFile,
      'run',
      '--rm',
      '--user',
      'root',
      'cli',
      'chown',
      '-R',
      `${process.getuid()}:${process.getgid()}`,
      '/var/www/html',
    ],
    commandOptions,
  );
}

async function defaultBrowserLoader(specifier) {
  let imported;
  try {
    imported = await import(specifier);
  } catch (error) {
    fail(
      `Browser capture unavailable: could not load ${specifier}: ` +
      `${error.message}. Install Playwright in the execution environment ` +
      'or pass --browser-module. No capture was started.',
    );
  }
  const driver = imported.default ?? imported;
  if (!driver.chromium?.launch) {
    fail(`Browser module ${specifier} does not expose chromium.launch()`);
  }
  return driver;
}

function validateRawSnapshot(snapshot, kind, plan) {
  object(snapshot, `${kind} snapshot`);
  if (snapshot.schemaVersion !== 1 || snapshot.kind !== kind) {
    fail(`${kind} snapshot has the wrong kind`);
  }
  if (snapshot.environmentId !== plan.environmentId) {
    fail(`${kind} snapshot has the wrong environment`);
  }
  if (
    typeof snapshot.capturedAt !== 'string' ||
    Number.isNaN(Date.parse(snapshot.capturedAt))
  ) {
    fail(`${kind} snapshot has an invalid capture time`);
  }
  if (!sha256Pattern.test(snapshot.profileHash ?? '')) {
    fail(`${kind} snapshot has an invalid profile hash`);
  }
  if (!sha256Pattern.test(snapshot.registryHash ?? '')) {
    fail(`${kind} snapshot has an invalid registry hash`);
  }
  if (!Array.isArray(snapshot.blocks) || snapshot.blocks.length === 0) {
    fail(`${kind} snapshot blocks must be a non-empty array`);
  }
  assertSame(
    snapshot.profile,
    plan.captureProfile,
    `${kind} snapshot profile`,
  );
  if (snapshot.profileHash !== sha256(JSON.stringify(snapshot.profile))) {
    fail(`${kind} snapshot profile hash does not match its profile`);
  }
  if (snapshot.registryHash !== sha256(JSON.stringify(snapshot.blocks))) {
    fail(`${kind} snapshot registry hash does not match its blocks`);
  }
  if (kind === 'server') {
    if (!/^\d+\.\d+\.\d+/.test(snapshot.phpVersion ?? '')) {
      fail('server snapshot has an invalid PHP version');
    }
    if (
      typeof snapshot.timezone !== 'string' ||
      snapshot.timezone.length === 0
    ) {
      fail('server snapshot has an invalid timezone');
    }
  }
}

function validateStaticProbe(probe) {
  object(probe, 'static probe');
  if (
    probe.kind !== 'static-save' ||
    probe.name !== 'core/paragraph' ||
    probe.valid !== true ||
    probe.parsedBlockCount !== 1 ||
    !Array.isArray(probe.issues) ||
    probe.issues.length !== 0 ||
    !sha256Pattern.test(probe.markupHash ?? '') ||
    probe.markupHash !== sha256(probe.markup ?? '') ||
    typeof probe.markup !== 'string'
  ) {
    fail('Core Paragraph static probe did not pass exact-runtime validation');
  }
}

async function captureBrowser(browser, plan, credentials, timeoutMs) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${plan.browserBaseUrl}/wp-login.php`, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    await page.locator('#user_login').fill(credentials.user);
    await page.locator('#user_pass').fill(credentials.password);
    await page.locator('#wp-submit').click({ timeout: timeoutMs });
    await page.waitForLoadState('domcontentloaded', {
      timeout: timeoutMs,
    });
    if (new URL(page.url()).pathname.endsWith('/wp-login.php')) {
      fail('Local WordPress browser authentication failed');
    }
    await page.goto(
      `${plan.browserBaseUrl}/wp-admin/post-new.php?post_type=post`,
      {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      },
    );
    await page.waitForSelector('body.wp-admin', { timeout: timeoutMs });
    await page.waitForFunction(
      () =>
        window.wp?.blocks?.getBlockTypes &&
        window.wp.blocks.getBlockTypes().length > 0,
      undefined,
      { timeout: timeoutMs },
    );
    await page.addScriptTag({ path: browserProbePath });
    return await page.evaluate(async (input) => {
      if (!window.wpBlockCatalogProbe) {
        throw new Error('wpBlockCatalogProbe did not load');
      }
      const snapshot = await window.wpBlockCatalogProbe.capture({
        environmentId: input.environmentId,
        editorSurface: 'core/edit-post',
        profile: input.profile,
      });
      const staticProbe = await window.wpBlockCatalogProbe.verifyStatic({
        name: 'core/paragraph',
        attributes: {
          content: 'Jetpack disconnected runtime',
        },
      });
      return { snapshot, staticProbe };
    }, {
      environmentId: plan.environmentId,
      profile: plan.profile,
    });
  } finally {
    await context.close();
  }
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function commandEnvironment(options, wpEnvHome) {
  const environment = withoutBrowserCredentials({
    ...process.env,
    ...options.commandEnvironment,
    WP_ENV_HOME: wpEnvHome,
  });
  delete environment[options.adminUserEnv];
  delete environment[options.adminPasswordEnv];
  return environment;
}

export async function runCapture(options, dependencies = {}) {
  const plan = await createCapturePlan(options);
  const adminUser = options.adminUser ??
    process.env[options.adminUserEnv];
  const adminPassword = options.adminPassword ??
    process.env[options.adminPasswordEnv];
  if (!adminUser || !adminPassword) {
    fail(
      `Browser capture requires ${options.adminUserEnv} and ` +
      `${options.adminPasswordEnv}`,
    );
  }

  const loadBrowser =
    dependencies.loadBrowserDriver ?? defaultBrowserLoader;
  const driver = await loadBrowser(options.browserModule);
  let browser;
  try {
    browser = await driver.chromium.launch({ headless: true });
  } catch (error) {
    fail(
      `Browser capture unavailable: Chromium could not start: ` +
      `${error.message}. No capture was started.`,
    );
  }

  const outputParent = dirname(plan.outputDirectory);
  await mkdir(outputParent, { recursive: true });
  const stagingDirectory = await mkdtemp(
    join(outputParent, `.${basename(plan.outputDirectory)}.staging-`),
  );
  const serverStagingPath = join(
    stagingDirectory,
    plan.serverFilename,
  );
  const mappedServerPath =
    `wp-content/mu-plugins/${plan.serverFilename}`;
  await writeFile(serverStagingPath, '', {
    encoding: 'utf8',
    mode: 0o600,
  });
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), 'wp-block-catalog-wp-env-'),
  );
  const wpEnvHome = join(temporaryRoot, 'wp-env-home');
  const temporaryConfigPath = join(temporaryRoot, '.wp-env.json');
  const temporaryConfig = {
    ...plan.config,
    mappings: {
      ...plan.config.mappings,
      [mappedProbePath]: phpProbePath,
      [mappedProfilePath]: plan.profilePath,
      [mappedServerPath]: serverStagingPath,
    },
  };
  await writeFile(
    temporaryConfigPath,
    jsonText(temporaryConfig),
    { encoding: 'utf8', mode: 0o600 },
  );

  const runCommand = dependencies.runCommand ?? runProcess;
  const commandOptions = {
    cwd: repositoryRoot,
    env: commandEnvironment(options, wpEnvHome),
    timeoutMs: options.timeoutMs,
  };
  let wpEnvAttempted = false;
  let operationError = null;
  const cleanupErrors = [];
  let captureResult = null;
  try {
    wpEnvAttempted = true;
    await startWpEnv(
      {
        ...options,
        temporaryConfigPath,
      },
      wpEnvHome,
      runCommand,
      commandOptions,
    );
    const versionResult = await runCommand(
      options.wpEnvBin,
      [
        'run',
        'cli',
        '--config',
        temporaryConfigPath,
        '--',
        'wp',
        'plugin',
        'get',
        'jetpack',
        '--field=version',
      ],
      commandOptions,
    );
    const versionLines = versionResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!versionLines.includes(plan.jetpackVersion)) {
      fail(
        `Active Jetpack version is not ${plan.jetpackVersion}`,
      );
    }

    await runCommand(
      options.wpEnvBin,
      [
        'run',
        'cli',
        '--config',
        temporaryConfigPath,
        '--',
        'wp',
        `--require=${mappedProbePath}`,
        'block-catalog',
        'snapshot',
        `--environment=${plan.environmentId}`,
        `--profile=${mappedProfilePath}`,
        '--editor-context=core/edit-post',
        `--output=${mappedServerPath}`,
      ],
      commandOptions,
    );

    const serverSnapshot = await readJson(
      serverStagingPath,
      'server snapshot',
    );
    validateRawSnapshot(serverSnapshot, 'server', plan);

    const browserCapture = await captureBrowser(
      browser,
      plan,
      { user: adminUser, password: adminPassword },
      options.timeoutMs,
    );
    validateRawSnapshot(browserCapture.snapshot, 'client', plan);
    validateStaticProbe(browserCapture.staticProbe);
    await writeFile(
      join(stagingDirectory, plan.clientFilename),
      jsonText(browserCapture.snapshot),
      { encoding: 'utf8', mode: 0o600 },
    );
    await writeFile(
      join(stagingDirectory, plan.staticFilename),
      jsonText(browserCapture.staticProbe),
      { encoding: 'utf8', mode: 0o600 },
    );
    captureResult = {
      outputDirectory: plan.outputDirectory,
      files: [
        plan.serverFilename,
        plan.clientFilename,
        plan.staticFilename,
      ],
    };
  } catch (error) {
    operationError = error;
  } finally {
    try {
      await browser.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (wpEnvAttempted) {
      try {
        await restoreWpEnvOwnership(
          options,
          wpEnvHome,
          runCommand,
          commandOptions,
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        await runCommand(
          options.wpEnvBin,
          [ 'destroy', '--force', '--config', temporaryConfigPath ],
          commandOptions,
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  }

  let finalError = operationError;
  if (cleanupErrors.length > 0) {
    const cleanupMessage = cleanupErrors
      .map((error) => error.message)
      .join('; ');
    if (finalError) {
      finalError = new Error(
        `${finalError.message}; capture cleanup failed: ${cleanupMessage}`,
      );
    } else {
      finalError = new Error(
        `Capture cleanup failed; refusing to publish evidence: ` +
        cleanupMessage,
      );
    }
  }
  if (!finalError && !captureResult) {
    finalError = new Error('Capture finished without validated evidence');
  }
  try {
    await rm(temporaryRoot, { recursive: true, force: true });
  } catch (error) {
    const cleanupMessage =
      `Could not remove isolated wp-env state: ${error.message}`;
    finalError = finalError
      ? new Error(`${finalError.message}; ${cleanupMessage}`)
      : new Error(cleanupMessage);
  }
  if (finalError) {
    try {
      await rm(stagingDirectory, { recursive: true, force: true });
    } catch (error) {
      throw new Error(
        `${finalError.message}; could not remove staged evidence: ` +
        error.message,
      );
    }
    throw finalError;
  }
  await rename(stagingDirectory, plan.outputDirectory);
  return captureResult;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = await runCapture(options);
  process.stdout.write(
    `${JSON.stringify({
      status: 'captured-raw-evidence',
      ...result,
      next:
        'Normalize and reconcile these files before granting evidence labels.',
    }, null, 2)}\n`,
  );
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`Capture failed closed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
