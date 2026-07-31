import assert from 'node:assert/strict';
import test from 'node:test';

import { importClientProbe, importServerProbe } from '../probe.js';
import {
  parseClientRuntimeSnapshot,
  parseServerRuntimeSnapshot,
} from '../runtime/index.js';

const profile = {
  environmentId: 'wordpress@7.0.2',
  productVersions: { wordpress: '7.0.2' },
  editorSurface: 'post-editor',
  locale: 'en_US',
  theme: { kind: 'block', slug: 'twentytwentysix' },
  featureFlags: {},
};

const fields = {
  name: 'core/paragraph',
  apiVersion: 3,
  attributes: { content: { type: 'string' } },
  supports: { anchor: true },
  parent: [],
  ancestor: [],
  allowedBlocks: [],
  providesContext: {},
  usesContext: [],
  variations: [],
  blockHooks: {},
};

test('imports and seals the PHP server probe shape', () => {
  const snapshot = importServerProbe({
    capturedAt: '2026-07-30T00:00:00Z',
    profile,
    blocks: [
      {
        ...fields,
        isDynamic: false,
        callbacks: { render: false },
        title: 'Ignored raw probe convenience field',
      },
    ],
  });

  assert.equal(snapshot.blocks[0]?.name, 'core/paragraph');
  assert.equal(snapshot.blocks[0]?.callbacks.render, false);
  assert.deepEqual(parseServerRuntimeSnapshot(snapshot), snapshot);
});

test('imports the authenticated core block-types REST shape', () => {
  const snapshot = importServerProbe({
    capturedAt: '2026-07-30T00:00:00Z',
    profile,
    blocks: [
      {
        name: 'core/paragraph',
        api_version: 3,
        attributes: { content: { type: 'string' } },
        supports: { anchor: true },
        parent: [],
        ancestor: [],
        allowed_blocks: [ 'core/group' ],
        provides_context: { 'core/postId': 'postId' },
        uses_context: [ 'core/postType' ],
        variations: [],
        block_hooks: { 'core/post-content': 'after' },
        is_dynamic: true,
      },
    ],
  });

  assert.deepEqual(snapshot.blocks[0], {
    ...fields,
    allowedBlocks: [ 'core/group' ],
    providesContext: { 'core/postId': 'postId' },
    usesContext: [ 'core/postType' ],
    blockHooks: { 'core/post-content': 'after' },
    isDynamic: true,
    callbacks: { render: null },
  });
  assert.deepEqual(parseServerRuntimeSnapshot(snapshot), snapshot);
});

test('imports client transforms and deprecation callback presence', () => {
  const snapshot = importClientProbe({
    capturedAt: '2026-07-30T00:00:00.000Z',
    profile,
    blocks: [
      {
        ...fields,
        inserterVisible: true,
        transforms: {
          from: [
            {
              type: 'block',
              blockNames: [ 'core/heading' ],
              callbacks: { transform: true, isMatch: false },
            },
          ],
          to: [],
        },
        deprecations: [
          {
            index: 0,
            attributes: {},
            supports: {},
            callbacks: {
              save: true,
              migrate: true,
              isEligible: false,
            },
          },
        ],
        callbacks: { edit: true, save: true },
      },
    ],
  });

  assert.equal(snapshot.blocks[0]?.transforms.from[0]?.callbacks.transform, true);
  assert.equal(snapshot.blocks[0]?.deprecations[0]?.callbacks.migrate, true);
  assert.deepEqual(parseClientRuntimeSnapshot(snapshot), snapshot);
});
