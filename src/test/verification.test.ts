import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MarkupVerifier,
  VerificationEvidenceSchema,
  hashCanonical,
  hashExactEnvironment,
  hashText,
  type DeprecatedMigrationRuntimeResult,
  type ExactEnvironment,
  type JsonObject,
  type MarkupVerificationRuntime,
  type ParseRuntimeResult,
  type RuntimeBlock,
  type ServerRenderRuntimeResult,
  type ValidateRuntimeResult,
} from '../verification/index.js';

const environment: ExactEnvironment = {
  id: 'wordpress-7.0.2-woocommerce-10.9.4',
  wordpressVersion: '7.0.2',
  phpVersion: '8.3.6',
  locale: 'en_US',
  timezone: 'UTC',
  sources: [
    {
      sourceId: 'wordpress@7.0.2',
      productVersion: '7.0.2',
      commit: '1'.repeat(40),
    },
    {
      sourceId: 'woocommerce@10.9.4',
      productVersion: '10.9.4',
      commit: '2'.repeat(40),
    },
  ],
  runtimeComponents: [
    {
      name: 'wordpress-editor',
      version: '7.0.2',
      artifactHash: 'a'.repeat(64),
    },
    {
      name: 'php-runtime',
      version: '8.3.6',
      artifactHash: 'b'.repeat(64),
    },
  ],
};

const paragraph: RuntimeBlock = {
  name: 'core/paragraph',
  attributes: { content: 'Verified content' },
  innerBlocks: [],
};

class FakeRuntime implements MarkupVerificationRuntime {
  calls: string[] = [];
  environments: ExactEnvironment[] = [ environment ];
  validation: ValidateRuntimeResult = {
    valid: true,
    diagnostics: [],
  };
  migration: DeprecatedMigrationRuntimeResult = {
    matchedDeprecation: 'v1',
    block: paragraph,
  };
  render: ServerRenderRuntimeResult = {
    executed: true,
    html: '<p>Server output</p>',
  };

  getEnvironment(): ExactEnvironment {
    this.calls.push('environment');
    return this.environments.shift() ?? environment;
  }

  async save(block: RuntimeBlock): Promise<{ markup: string }> {
    this.calls.push('save');
    const content = String(block.attributes.content ?? '');
    return {
      markup: `<!-- wp:${block.name} --><p>${content}</p><!-- /wp:${block.name} -->`,
    };
  }

  async parse(markup: string): Promise<ParseRuntimeResult> {
    this.calls.push('parse');
    const match = markup.match(/<!-- wp:([a-z0-9-]+\/[a-z0-9-]+)/);
    return {
      blocks: match?.[1]
        ? [ { ...paragraph, name: match[1] } ]
        : [],
    };
  }

  async validate(
    _block: RuntimeBlock,
    _markup: string,
    _parsed: ParseRuntimeResult,
  ): Promise<ValidateRuntimeResult> {
    this.calls.push('validate');
    return this.validation;
  }

  async migrateDeprecated(
    _blockName: string,
    _fixtureMarkup: string,
  ): Promise<DeprecatedMigrationRuntimeResult> {
    this.calls.push('migrate');
    return this.migration;
  }

  async renderDynamic(
    _block: RuntimeBlock,
    _context: JsonObject,
  ): Promise<ServerRenderRuntimeResult> {
    this.calls.push('render');
    return this.render;
  }
}

test('grants save evidence only after exact save, parse, and validation', async () => {
  const runtime = new FakeRuntime();
  const verifier = new MarkupVerifier(runtime);

  const evidence = await verifier.verifyStaticSave({
    block: paragraph,
    expectedEnvironment: environment,
  });

  assert.equal(evidence.status, 'passed');
  assert.deepEqual(evidence.labelsGranted, [ 'save-runtime-valid' ]);
  assert.deepEqual(runtime.calls, [
    'environment',
    'save',
    'parse',
    'validate',
    'environment',
  ]);
  assert.doesNotThrow(() => VerificationEvidenceSchema.parse(evidence));
});

test('produces deterministic evidence and canonical hashes', async () => {
  const first = await new MarkupVerifier(
    new FakeRuntime(),
  ).verifyStaticSave({
    block: paragraph,
    expectedEnvironment: environment,
  });
  const second = await new MarkupVerifier(
    new FakeRuntime(),
  ).verifyStaticSave({
    block: paragraph,
    expectedEnvironment: environment,
  });

  assert.equal(first.evidenceHash, second.evidenceHash);
  assert.equal(hashCanonical({ b: 2, a: 1 }), hashCanonical({ a: 1, b: 2 }));
});

test('does not grant a label when exact runtime validation fails', async () => {
  const runtime = new FakeRuntime();
  runtime.validation = {
    valid: false,
    diagnostics: [ 'save output differs from stored content' ],
  };

  const evidence = await new MarkupVerifier(
    runtime,
  ).verifyStaticSave({
    block: paragraph,
    expectedEnvironment: environment,
  });

  assert.equal(evidence.status, 'failed');
  assert.deepEqual(evidence.labelsGranted, []);
  assert.equal(evidence.failure?.code, 'runtime-validation-failed');
  assert.doesNotThrow(() => VerificationEvidenceSchema.parse(evidence));
});

test('reports output drift without granting save evidence', async () => {
  const evidence = await new MarkupVerifier(
    new FakeRuntime(),
  ).verifyStaticSave({
    block: paragraph,
    expectedEnvironment: environment,
    expectedOutputHash: 'f'.repeat(64),
  });

  assert.equal(evidence.status, 'drift');
  assert.deepEqual(evidence.labelsGranted, []);
  assert.equal(evidence.failure?.code, 'output-drift');
});

test('rejects a different runtime before executing block code', async () => {
  const runtime = new FakeRuntime();
  runtime.environments = [
    {
      ...environment,
      wordpressVersion: '7.1.0',
    },
  ];

  const evidence = await new MarkupVerifier(
    runtime,
  ).verifyStaticSave({
    block: paragraph,
    expectedEnvironment: environment,
  });

  assert.equal(evidence.status, 'drift');
  assert.equal(evidence.failure?.code, 'environment-mismatch');
  assert.deepEqual(runtime.calls, [ 'environment' ]);
});

test('rejects environment drift during exact runtime execution', async () => {
  const runtime = new FakeRuntime();
  runtime.environments = [
    environment,
    {
      ...environment,
      phpVersion: '8.4.0',
    },
  ];

  const evidence = await new MarkupVerifier(
    runtime,
  ).verifyStaticSave({
    block: paragraph,
    expectedEnvironment: environment,
  });

  assert.equal(evidence.status, 'drift');
  assert.deepEqual(evidence.labelsGranted, []);
  assert.equal(evidence.failure?.code, 'environment-drift');
});

test('grants deprecated evidence only after migration and current validation', async () => {
  const runtime = new FakeRuntime();
  const fixture =
    '<!-- wp:core/paragraph {"oldContent":"Legacy"} --><p>Legacy</p><!-- /wp:core/paragraph -->';

  const evidence = await new MarkupVerifier(
    runtime,
  ).verifyDeprecatedFixture({
    blockName: 'core/paragraph',
    fixtureMarkup: fixture,
    expectedEnvironment: environment,
  });

  assert.equal(evidence.status, 'passed');
  assert.deepEqual(evidence.labelsGranted, [
    'deprecated-fixture-valid',
  ]);
  assert.deepEqual(runtime.calls, [
    'environment',
    'migrate',
    'save',
    'parse',
    'validate',
    'environment',
  ]);
});

test('does not accept a fixture that matched no runtime deprecation', async () => {
  const runtime = new FakeRuntime();
  runtime.migration = {
    matchedDeprecation: null,
    block: null,
  };

  const evidence = await new MarkupVerifier(
    runtime,
  ).verifyDeprecatedFixture({
    blockName: 'core/paragraph',
    fixtureMarkup: '<!-- wp:core/paragraph /-->',
    expectedEnvironment: environment,
  });

  assert.equal(evidence.status, 'failed');
  assert.deepEqual(evidence.labelsGranted, []);
  assert.equal(evidence.failure?.code, 'deprecation-not-matched');
});

test('accepts an executed dynamic render even when output is empty', async () => {
  const runtime = new FakeRuntime();
  runtime.render = { executed: true, html: '' };

  const evidence = await new MarkupVerifier(
    runtime,
  ).verifyDynamicServerRender({
    block: {
      name: 'woocommerce/store-notices',
      attributes: {},
      innerBlocks: [],
    },
    context: { notices: [] },
    expectedEnvironment: environment,
    expectedOutputHash: hashText(''),
  });

  assert.equal(evidence.status, 'passed');
  assert.deepEqual(evidence.labelsGranted, [ 'server-render-valid' ]);
  assert.equal(evidence.outputHash, hashText(''));
});

test('does not grant server evidence when render callback was not executed', async () => {
  const runtime = new FakeRuntime();
  runtime.render = { executed: false, html: '<p>Heuristic output</p>' };

  const evidence = await new MarkupVerifier(
    runtime,
  ).verifyDynamicServerRender({
    block: {
      name: 'woocommerce/store-notices',
      attributes: {},
      innerBlocks: [],
    },
    context: {},
    expectedEnvironment: environment,
  });

  assert.equal(evidence.status, 'failed');
  assert.deepEqual(evidence.labelsGranted, []);
  assert.equal(evidence.failure?.code, 'server-render-not-executed');
});

test('environment hash changes with any exact runtime component', () => {
  const changed: ExactEnvironment = {
    ...environment,
    runtimeComponents: environment.runtimeComponents.map(
      (component, index) =>
        index === 0
          ? { ...component, artifactHash: 'c'.repeat(64) }
          : component,
    ),
  };

  assert.notEqual(
    hashExactEnvironment(environment),
    hashExactEnvironment(changed),
  );
});

test('records the exact stage when a runtime adapter throws', async () => {
  const runtime = new FakeRuntime();
  runtime.parse = async () => {
    runtime.calls.push('parse');
    throw new Error('Parser process exited');
  };

  const evidence = await new MarkupVerifier(
    runtime,
  ).verifyStaticSave({
    block: paragraph,
    expectedEnvironment: environment,
  });

  assert.equal(evidence.status, 'failed');
  assert.equal(evidence.failure?.stage, 'parse');
  assert.equal(evidence.failure?.code, 'runtime-error');
  assert.deepEqual(evidence.labelsGranted, []);
});
