import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { scanSource } from './scan.js';
import {
  BuildConfigSchema,
  CatalogArtifactSchema,
  EnvironmentSchema,
  SourceManifestSchema,
} from './schema.js';
import type { CatalogArtifact, SourceManifest } from './schema.js';

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function buildCatalog(configPath: string): Promise<CatalogArtifact> {
  const absoluteConfigPath = resolve(configPath);
  const configDirectory = dirname(absoluteConfigPath);
  const config = BuildConfigSchema.parse(await readJson(absoluteConfigPath));

  const sources: SourceManifest[] = [];
  const blocks = [];
  const environments = [ ...config.environments ];

  for (const environmentFile of config.environmentFiles) {
    environments.push(
      EnvironmentSchema.parse(
        await readJson(resolve(configDirectory, environmentFile)),
      ),
    );
  }

  const environmentIds = new Set<string>();
  for (const environment of environments) {
    if (environmentIds.has(environment.id)) {
      throw new Error(`Duplicate environment ${environment.id}`);
    }
    environmentIds.add(environment.id);
  }

  for (const entry of config.sources) {
    const manifestPath = resolve(configDirectory, entry.manifest);
    const checkoutPath = resolve(configDirectory, entry.checkout);
    const source = SourceManifestSchema.parse(await readJson(manifestPath));

    if (config.visibility === 'public' && source.visibility !== 'public') {
      throw new Error(
        `Public catalogue cannot include private source ${source.id}`,
      );
    }

    sources.push(source);
    blocks.push(...await scanSource(source, checkoutPath));
  }

  const sourceIds = new Set(sources.map((source) => source.id));
  for (const environment of environments) {
    if (
      config.visibility === 'public' &&
      environment.visibility !== 'public'
    ) {
      throw new Error(
        `Public catalogue cannot include private environment ${environment.id}`,
      );
    }
    for (const layer of environment.layers) {
      if (!sourceIds.has(layer.sourceId)) {
        throw new Error(
          `Environment ${environment.id} references missing source ${layer.sourceId}`,
        );
      }
    }
  }

  const artifact = CatalogArtifactSchema.parse({
    schemaVersion: 1,
    catalogVersion: config.catalogVersion,
    generatedAt: new Date().toISOString(),
    sources,
    environments,
    blocks,
  });

  const outputPath = resolve(configDirectory, config.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(artifact, null, 2)}\n`,
    'utf8',
  );
  return artifact;
}
