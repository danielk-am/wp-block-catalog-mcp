import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { buildCatalog } from './build.js';
import { Catalog } from './catalog.js';
import {
  hashArtifact,
  prepareDeliveryArtifact,
} from './delivery/index.js';
import {
  ReleaseGatePolicySchema,
  evaluateReleaseGates,
  summarizeReleaseDiff,
} from './diff/index.js';
import { importClientProbe, importServerProbe } from './probe.js';
import { sealRecordedVerifications } from './recorded.js';
import { createRuntimeReconciliationBundle } from './runtime/index.js';

function usage(): never {
  throw new Error(
    [
      'Usage:',
      '  wp-block-catalog build <build-config.json>',
      '  wp-block-catalog normalize-probe <server|client> <input.json> <output.json>',
      '  wp-block-catalog seal-probes <environment.json> <static.json|-> <deprecated.json|-> <dynamic.json|-> <output.json>',
      '  wp-block-catalog reconcile <catalog.json> <environment> <server.json> [client.json] <output.json>',
      '  wp-block-catalog deliver <public|private> <input.json> <output.json>',
      '  wp-block-catalog hash <catalog.json>',
      '  wp-block-catalog diff <public|private> <previous.json> <next.json>',
      '  wp-block-catalog gate <policy.json> <previous.json> <next.json>',
    ].join('\n'),
  );
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const output = resolve(path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function visibility(value: string | undefined): 'public' | 'private' {
  if (value !== 'public' && value !== 'private') {
    usage();
  }
  return value;
}

async function main(): Promise<void> {
  const [ command, ...args ] = process.argv.slice(2);

  if (command === 'build') {
    const [ configPath ] = args;
    if (!configPath) usage();
    const artifact = await buildCatalog(configPath);
    process.stdout.write(
      `Built ${artifact.blocks.length} blocks into catalogue ` +
      `${artifact.catalogVersion}\n`,
    );
    return;
  }

  if (command === 'normalize-probe') {
    const [ kind, inputPath, outputPath ] = args;
    if (
      (kind !== 'server' && kind !== 'client') ||
      !inputPath ||
      !outputPath
    ) {
      usage();
    }
    const input = await readJson(inputPath);
    const snapshot = kind === 'server'
      ? importServerProbe(input)
      : importClientProbe(input);
    await writeJson(outputPath, snapshot);
    process.stdout.write(
      `Normalised ${kind} snapshot ${snapshot.registryHash}\n`,
    );
    return;
  }

  if (command === 'deliver') {
    const [ visibilityArg, inputPath, outputPath ] = args;
    if (!inputPath || !outputPath) usage();
    const targetVisibility = visibility(visibilityArg);
    const artifact = prepareDeliveryArtifact(
      await readJson(inputPath),
      targetVisibility,
    );
    await writeJson(outputPath, artifact);
    process.stdout.write(
      `Prepared ${targetVisibility} artefact ${hashArtifact(artifact)}\n`,
    );
    return;
  }

  if (command === 'seal-probes') {
    const [
      environmentPath,
      staticPath,
      deprecatedPath,
      dynamicPath,
      outputPath,
    ] = args;
    if (
      !environmentPath ||
      !staticPath ||
      !deprecatedPath ||
      !dynamicPath ||
      !outputPath
    ) {
      usage();
    }
    const bundle = sealRecordedVerifications({
      environment: await readJson(environmentPath),
      staticProbes:
        staticPath === '-' ? [] : [ await readJson(staticPath) ],
      deprecatedProbes:
        deprecatedPath === '-' ? [] : [ await readJson(deprecatedPath) ],
      dynamicProbes:
        dynamicPath === '-' ? [] : [ await readJson(dynamicPath) ],
    });
    await writeJson(outputPath, bundle);
    process.stdout.write(
      `Sealed ${bundle.records.length} runtime verification records\n`,
    );
    return;
  }

  if (command === 'reconcile') {
    const [ catalogPath, environmentId, serverPath, fourth, fifth ] = args;
    const clientPath = fifth ? fourth : undefined;
    const outputPath = fifth ?? fourth;
    if (
      !catalogPath ||
      !environmentId ||
      !serverPath ||
      !outputPath
    ) {
      usage();
    }
    const bundle = createRuntimeReconciliationBundle(
      new Catalog(await readJson(catalogPath)),
      environmentId,
      await readJson(serverPath),
      clientPath ? await readJson(clientPath) : undefined,
    );
    await writeJson(outputPath, bundle);
    process.stdout.write(
      `Reconciled ${bundle.reconciliations.length} definitions, ` +
      `${bundle.serverOnly.length} server-only, ` +
      `${bundle.clientOnly.length} client-only\n`,
    );
    return;
  }

  if (command === 'hash') {
    const [ inputPath ] = args;
    if (!inputPath) usage();
    process.stdout.write(`${hashArtifact(await readJson(inputPath))}\n`);
    return;
  }

  if (command === 'diff') {
    const [ visibilityArg, previousPath, nextPath ] = args;
    if (!previousPath || !nextPath) usage();
    const result = summarizeReleaseDiff(
      await readJson(previousPath),
      await readJson(nextPath),
      visibility(visibilityArg),
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === 'gate') {
    const [ policyPath, previousPath, nextPath ] = args;
    if (!policyPath || !previousPath || !nextPath) usage();
    const policy = ReleaseGatePolicySchema.parse(await readJson(policyPath));
    const result = evaluateReleaseGates(
      await readJson(previousPath),
      await readJson(nextPath),
      policy,
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.passed) {
      process.exitCode = 1;
    }
    return;
  }

  usage();
}

await main();
