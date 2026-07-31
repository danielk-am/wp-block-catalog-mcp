import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hashCanonical,
  hashExactEnvironment,
  hashText,
  sealEvidence,
} from '../verification/index.js';
import { VerifiedMarkupStore } from '../verified.js';

const environment = {
  id: 'wordpress@7.0.2',
  wordpressVersion: '7.0.2',
  phpVersion: '8.3.0',
  locale: 'en_US',
  timezone: 'UTC',
  sources: [
    {
      sourceId: 'wordpress@7.0.2',
      productVersion: '7.0.2',
      commit: '1'.repeat(40),
    },
  ],
  runtimeComponents: [
    {
      name: 'wordpress',
      version: '7.0.2',
      artifactHash: '2'.repeat(64),
    },
  ],
};
const block = {
  name: 'core/paragraph',
  attributes: { content: 'Hello' },
  innerBlocks: [],
};
const markup = '<!-- wp:paragraph --><p>Hello</p><!-- /wp:paragraph -->';

function bundle() {
  const evidence = sealEvidence({
    schemaVersion: 1,
    kind: 'static-save',
    blockName: block.name,
    status: 'passed',
    labelsGranted: [ 'save-runtime-valid' ],
    expectedEnvironment: environment,
    expectedEnvironmentHash: hashExactEnvironment(environment),
    observedEnvironmentBefore: environment,
    observedEnvironmentAfter: environment,
    inputHash: hashCanonical(block),
    outputHash: hashText(markup),
    stages: [],
    failure: null,
  });

  return {
    schemaVersion: 1,
    records: [
      {
        id: 'paragraph-hello',
        environmentId: environment.id,
        block,
        context: {},
        fixtureMarkup: null,
        markup,
        evidence,
      },
    ],
  };
}

test('serves only markup sealed by exact passed runtime evidence', () => {
  const store = new VerifiedMarkupStore(bundle());
  assert.equal(
    store.generate(environment.id, block)?.markup,
    markup,
  );
  assert.equal(
    store.validate(environment.id, markup)?.evidence.status,
    'passed',
  );
  assert.equal(
    store.generate(environment.id, {
      ...block,
      attributes: { content: 'Different' },
    }),
    null,
  );
});

test('rejects markup whose bytes do not match its evidence hash', () => {
  const input = bundle();
  input.records[0]!.markup = `${markup}\n`;
  assert.throws(
    () => new VerifiedMarkupStore(input),
    /Stored markup does not match passed runtime evidence/,
  );
});

test('combines exact-runtime evidence from multiple profile bundles', () => {
  const first = bundle();
  const second = bundle();
  second.records[0]!.id = 'paragraph-second-profile';
  second.records[0]!.environmentId = 'wordpress@7.0.2+gutenberg@23.6.2';
  second.records[0]!.evidence.expectedEnvironment = {
    ...second.records[0]!.evidence.expectedEnvironment,
    id: second.records[0]!.environmentId,
  };
  second.records[0]!.evidence.expectedEnvironmentHash =
    hashExactEnvironment(
      second.records[0]!.evidence.expectedEnvironment,
    );
  second.records[0]!.evidence.observedEnvironmentBefore =
    second.records[0]!.evidence.expectedEnvironment;
  second.records[0]!.evidence.observedEnvironmentAfter =
    second.records[0]!.evidence.expectedEnvironment;
  const {
    evidenceHash: _previousEvidenceHash,
    ...unsignedEvidence
  } = second.records[0]!.evidence;
  second.records[0]!.evidence.evidenceHash =
    sealEvidence(unsignedEvidence).evidenceHash;

  const store = new VerifiedMarkupStore([ first, second ]);
  assert.equal(store.bundle.records.length, 2);
  assert.equal(
    store.generate(second.records[0]!.environmentId, block)?.markup,
    markup,
  );
});

test('rejects duplicate verification record identities across bundles', () => {
  assert.throws(
    () => new VerifiedMarkupStore([ bundle(), bundle() ]),
    /Duplicate verified markup record/,
  );
});
