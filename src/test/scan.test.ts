import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { scanSource } from '../scan.js';
import { coreSource } from './fixtures.js';

const execFileAsync = promisify(execFile);

test('scans a checkout only when its immutable commit matches', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wp-block-catalog-'));
  t.after(async () => rm(root, { recursive: true, force: true }));

  await mkdir(join(root, 'src/wp-includes/blocks/paragraph'), {
    recursive: true,
  });
  await writeFile(
    join(root, 'src/wp-includes/blocks/paragraph/block.json'),
    JSON.stringify({
      name: 'core/paragraph',
      title: 'Paragraph',
      apiVersion: 3,
    }),
  );
  await execFileAsync('git', [ '-C', root, 'init', '-b', 'main' ]);
  await execFileAsync('git', [ '-C', root, 'add', '.' ]);
  await execFileAsync(
    'git',
    [
      '-C',
      root,
      '-c',
      'user.name=Catalogue Test',
      '-c',
      'user.email=catalogue-test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'fixture',
    ],
  );
  const { stdout } = await execFileAsync(
    'git',
    [ '-C', root, 'rev-parse', 'HEAD' ],
    { encoding: 'utf8' },
  );

  const source = { ...coreSource, commit: stdout.trim() };
  const blocks = await scanSource(source, root);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.name, 'core/paragraph');
  assert.equal(blocks[0]?.provenance.commit, stdout.trim());
  assert.match(blocks[0]?.provenance.contentHash ?? '', /^[0-9a-f]{64}$/);
});

test('rejects a checkout at the wrong commit', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wp-block-catalog-'));
  t.after(async () => rm(root, { recursive: true, force: true }));

  await execFileAsync('git', [ '-C', root, 'init', '-b', 'main' ]);
  await writeFile(join(root, 'README.md'), 'fixture\n');
  await execFileAsync('git', [ '-C', root, 'add', '.' ]);
  await execFileAsync(
    'git',
    [
      '-C',
      root,
      '-c',
      'user.name=Catalogue Test',
      '-c',
      'user.email=catalogue-test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'fixture',
    ],
  );

  await assert.rejects(
    () => scanSource(coreSource, root),
    /expected .* checkout is/,
  );
});
