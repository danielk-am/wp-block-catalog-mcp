import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { sealRecordedVerifications } from '../recorded.js';
import { VerifiedMarkupStore } from '../verified.js';

const environment = {
  id: 'wordpress@7.0.2',
  wordpressVersion: '7.0.2',
  phpVersion: '8.3.32',
  locale: 'en_US',
  timezone: '+00:00',
  sources: [
    {
      sourceId: 'wordpress@7.0.2',
      productVersion: '7.0.2',
      commit: '1'.repeat(40),
    },
  ],
  runtimeComponents: [
    {
      name: 'client-registry',
      version: '7.0.2',
      artifactHash: '2'.repeat(64),
    },
  ],
};

test('seals passed recorded runtime output into a verified bundle', () => {
  const markup = '<!-- wp:paragraph --><p>Hello</p><!-- /wp:paragraph -->';
  const hash = createHash('sha256').update(markup).digest('hex');
  const bundle = sealRecordedVerifications({
    environment,
    staticProbes: [
      {
        kind: 'static-save',
        name: 'core/paragraph',
        attributes: { content: 'Hello' },
        markup,
        markupHash: hash,
        parsedBlockCount: 1,
        valid: true,
        issues: [],
      },
    ],
  });
  const store = new VerifiedMarkupStore(bundle);

  assert.equal(bundle.records[0]?.evidence.status, 'passed');
  assert.equal(
    store.generate(environment.id, {
      name: 'core/paragraph',
      attributes: { content: 'Hello' },
      innerBlocks: [],
    })?.markup,
    markup,
  );
});

test('refuses a recorded result with tampered markup bytes', () => {
  assert.throws(() =>
    sealRecordedVerifications({
      environment,
      dynamicProbes: [
        {
          kind: 'server-render',
          name: 'core/latest-posts',
          attributes: {},
          markup: '<ul></ul>',
          markupHash: '3'.repeat(64),
          isDynamic: true,
          callbacks: { render: true },
        },
      ],
    }), /markup hash mismatch/);
});
