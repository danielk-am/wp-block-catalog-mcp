import assert from 'node:assert/strict';
import test from 'node:test';

import { Catalog } from '../catalog.js';
import { testArtifact } from './fixtures.js';

test('resolves core when no override layer is active', () => {
  const catalog = new Catalog(testArtifact());
  const resolved = catalog.resolve('core/paragraph', 'wordpress-only');

  assert.equal(resolved?.definition.product, 'wordpress');
  assert.equal(resolved?.shadowed.length, 0);
});

test('resolves Gutenberg override and reports shadowed core definition', () => {
  const catalog = new Catalog(testArtifact());
  const resolved = catalog.resolve(
    'core/paragraph',
    'wordpress-with-gutenberg',
  );

  assert.equal(resolved?.definition.product, 'gutenberg');
  assert.deepEqual(
    resolved?.shadowed.map((block) => block.product),
    [ 'wordpress' ],
  );
});

test('searches the resolved environment rather than raw duplicates', () => {
  const catalog = new Catalog(testArtifact());
  const results = catalog.search({
    query: 'paragraph',
    environment: 'wordpress-with-gutenberg',
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.definition.title, 'Gutenberg Paragraph');
});

test('rejects equal-priority duplicate definitions', () => {
  const artifact = testArtifact();
  const environment = artifact.environments[1];
  if (!environment) {
    throw new Error('Missing override test environment');
  }
  const baseLayer = environment.layers[0];
  const overrideLayer = environment.layers[1];
  if (!baseLayer || !overrideLayer) {
    throw new Error('Missing override test layers');
  }
  environment.layers[0] = {
    ...baseLayer,
    priority: overrideLayer.priority,
  };

  const catalog = new Catalog(artifact);
  assert.throws(
    () => catalog.resolve('core/paragraph', environment.id),
    /Ambiguous block/,
  );
});
