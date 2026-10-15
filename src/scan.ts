import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { promisify } from 'node:util';

import { glob } from 'tinyglobby';

import { normalizeBlockMetadata } from './normalize.js';
import type { BlockDefinition, SourceManifest } from './schema.js';

const execFileAsync = promisify(execFile);

async function checkoutCommit(checkout: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    [ '-C', checkout, 'rev-parse', 'HEAD' ],
    { encoding: 'utf8' },
  );
  return stdout.trim();
}

export async function scanSource(
  source: SourceManifest,
  checkout: string,
): Promise<BlockDefinition[]> {
  const actualCommit = await checkoutCommit(checkout);
  if (actualCommit.toLowerCase() !== source.commit.toLowerCase()) {
    throw new Error(
      `Source ${source.id} expected ${source.commit}, checkout is ${actualCommit}`,
    );
  }

  const checkoutRoot = await realpath(checkout);
  const paths = await glob(source.include, {
    cwd: checkoutRoot,
    onlyFiles: true,
    expandDirectories: false,
    followSymbolicLinks: false,
    ignore: source.exclude,
  });
  paths.sort();

  const blocks: BlockDefinition[] = [];
  const seen = new Map<string, string>();

  for (const path of paths) {
    const absolutePath = await realpath(`${checkoutRoot}/${path}`);
    if (
      absolutePath !== checkoutRoot &&
      !absolutePath.startsWith(`${checkoutRoot}/`)
    ) {
      throw new Error(`Source path escaped checkout root: ${path}`);
    }

    const content = await readFile(absolutePath, 'utf8');
    const metadata: unknown = JSON.parse(content);
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new Error(`Expected object metadata in ${path}`);
    }

    const block = normalizeBlockMetadata(
      metadata as Record<string, unknown>,
      {
        source,
        path,
        contentHash: createHash('sha256').update(content).digest('hex'),
      },
    );
    const previous = seen.get(block.name);
    if (previous) {
      throw new Error(
        `Duplicate block ${block.name} in source ${source.id}: ` +
        `${previous} and ${path}`,
      );
    }
    seen.set(block.name, path);
    blocks.push(block);
  }

  return blocks;
}
