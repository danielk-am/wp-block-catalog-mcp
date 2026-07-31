import assert from 'node:assert/strict';
import test from 'node:test';

import { checkCatalogHealth } from './check-catalog-health.mjs';

test('catalogue health reports counts without catalogue inventory', async () => {
  const result = await checkCatalogHealth();
  assert.equal(result.passed, true);
  assert.equal(result.public.passed, true);
  assert.equal(result.public.counts.sources.next, 4);

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('addedDefinitions'), false);
  assert.equal(serialized.includes('addedBlockNames'), false);
  assert.equal(serialized.includes('removedDefinitions'), false);
  assert.equal(serialized.includes('removedBlockNames'), false);
});
