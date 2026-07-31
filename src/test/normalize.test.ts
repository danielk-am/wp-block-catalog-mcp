import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeBlockMetadata } from '../normalize.js';
import { coreSource } from './fixtures.js';

test('preserves raw metadata and normalizes relationship fields', () => {
  const raw = {
    name: 'core/list',
    title: 'List',
    apiVersion: 3,
    parent: [ 'core/group' ],
    ancestor: [ 'core/post-content' ],
    allowedBlocks: [ 'core/list-item' ],
    providesContext: { 'core/listId': 'id' },
    usesContext: [ 'core/postId' ],
    blockHooks: { 'core/post-content': 'after' },
    __experimental: 'fse',
    customFutureField: { preserved: true },
  };

  const block = normalizeBlockMetadata(raw, {
    source: coreSource,
    path: 'src/wp-includes/blocks/list/block.json',
  });

  assert.deepEqual(
    block.relationships.map(({ kind, target }) => ({ kind, target })),
    [
      { kind: 'parent', target: 'core/group' },
      { kind: 'ancestor', target: 'core/post-content' },
      { kind: 'allows_child', target: 'core/list-item' },
      { kind: 'provides_context', target: 'core/listId' },
      { kind: 'uses_context', target: 'core/postId' },
      { kind: 'block_hook', target: 'core/post-content' },
    ],
  );
  assert.deepEqual(block.rawMetadata.customFutureField, { preserved: true });
  assert.deepEqual(block.availability, {
    sourcePresent: true,
    includedInBuild: null,
    serverRegistered: null,
    clientRegistered: null,
    inserterVisible: null,
    editorSurfaces: [],
    experimental: 'fse',
    gates: [],
    state: 'unknown',
  });
});

test('does not invent the apiVersion default', () => {
  const block = normalizeBlockMetadata(
    { name: 'core/example', title: 'Example' },
    {
      source: coreSource,
      path: 'src/wp-includes/blocks/example/block.json',
    },
  );

  assert.equal(block.apiVersion, null);
});
