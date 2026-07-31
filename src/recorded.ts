import { z } from 'zod';

import { JsonObjectSchema } from './runtime/index.js';
import {
  ExactEnvironmentSchema,
  hashCanonical,
  hashExactEnvironment,
  hashText,
  sealEvidence,
} from './verification/index.js';
import type {
  ExactEnvironment,
  RuntimeBlock,
  VerificationEvidence,
  VerificationStageName,
} from './verification/index.js';
import {
  VerifiedMarkupBundleSchema,
} from './verified.js';
import type {
  VerifiedMarkupBundle,
  VerifiedMarkupRecord,
} from './verified.js';

const BlockNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*\/[a-z0-9-]+$/);

const StaticProbeSchema = z.object({
  kind: z.literal('static-save'),
  name: BlockNameSchema,
  attributes: JsonObjectSchema,
  markup: z.string(),
  markupHash: z.string().regex(/^[0-9a-f]{64}$/),
  parsedBlockCount: z.literal(1),
  valid: z.literal(true),
  issues: z.array(z.unknown()),
}).passthrough();

const DeprecatedProbeSchema = z.object({
  kind: z.literal('deprecated-fixture'),
  name: BlockNameSchema,
  fixtureMarkup: z.string(),
  inputMarkupHash: z.string().regex(/^[0-9a-f]{64}$/),
  currentMarkup: z.string(),
  currentMarkupHash: z.string().regex(/^[0-9a-f]{64}$/),
  attributes: JsonObjectSchema,
  innerBlocks: z.array(z.unknown()),
  migrated: z.literal(true),
  valid: z.literal(true),
  issues: z.array(z.unknown()),
}).passthrough();

const DynamicProbeSchema = z.object({
  kind: z.literal('server-render'),
  name: BlockNameSchema,
  attributes: JsonObjectSchema,
  markup: z.string(),
  markupHash: z.string().regex(/^[0-9a-f]{64}$/),
  isDynamic: z.literal(true),
  callbacks: z.object({ render: z.literal(true) }),
}).passthrough();

export interface RecordedVerificationInputs {
  environment: unknown;
  staticProbes?: unknown[];
  deprecatedProbes?: unknown[];
  dynamicProbes?: unknown[];
}

function stage(
  name: VerificationStageName,
  inputHash: string,
  outputHash: string,
  details: Record<string, unknown> = {},
) {
  return {
    name,
    status: 'success' as const,
    inputHash,
    outputHash,
    details,
  };
}

function evidence(
  environment: ExactEnvironment,
  input: {
    kind: 'static-save' | 'deprecated-fixture' | 'dynamic-server-render';
    blockName: string;
    inputHash: string;
    outputHash: string;
    stages: ReturnType<typeof stage>[];
  },
): VerificationEvidence {
  const labels = {
    'static-save': 'save-runtime-valid',
    'deprecated-fixture': 'deprecated-fixture-valid',
    'dynamic-server-render': 'server-render-valid',
  } as const;
  return sealEvidence({
    schemaVersion: 1,
    kind: input.kind,
    blockName: input.blockName,
    status: 'passed',
    labelsGranted: [ labels[input.kind] ],
    expectedEnvironment: environment,
    expectedEnvironmentHash: hashExactEnvironment(environment),
    observedEnvironmentBefore: environment,
    observedEnvironmentAfter: environment,
    inputHash: input.inputHash,
    outputHash: input.outputHash,
    stages: input.stages,
    failure: null,
  });
}

function staticRecord(
  environment: ExactEnvironment,
  raw: unknown,
  index: number,
): VerifiedMarkupRecord {
  const probe = StaticProbeSchema.parse(raw);
  if (probe.markupHash !== hashText(probe.markup)) {
    throw new Error(`Static probe ${probe.name} markup hash mismatch`);
  }
  const block: RuntimeBlock = {
    name: probe.name,
    attributes: probe.attributes,
    innerBlocks: [],
  };
  const inputHash = hashCanonical(block);
  const parseHash = hashCanonical({
    parsedBlockCount: probe.parsedBlockCount,
  });
  const verification = evidence(environment, {
    kind: 'static-save',
    blockName: probe.name,
    inputHash,
    outputHash: probe.markupHash,
    stages: [
      stage('save', inputHash, probe.markupHash),
      stage('parse', probe.markupHash, parseHash, {
        parsedBlockCount: 1,
      }),
      stage('validate', parseHash, hashCanonical({
        valid: probe.valid,
        issues: probe.issues,
      })),
    ],
  });
  return {
    id: `static:${probe.name}:${index}`,
    environmentId: environment.id,
    block,
    context: {},
    fixtureMarkup: null,
    markup: probe.markup,
    evidence: verification,
  };
}

function deprecatedRecord(
  environment: ExactEnvironment,
  raw: unknown,
  index: number,
): VerifiedMarkupRecord {
  const probe = DeprecatedProbeSchema.parse(raw);
  if (
    probe.inputMarkupHash !== hashText(probe.fixtureMarkup) ||
    probe.currentMarkupHash !== hashText(probe.currentMarkup)
  ) {
    throw new Error(`Deprecated probe ${probe.name} markup hash mismatch`);
  }
  const block: RuntimeBlock = {
    name: probe.name,
    attributes: probe.attributes,
    innerBlocks: [],
  };
  const migrationHash = hashCanonical(block);
  const parseHash = hashCanonical({ parsedBlockCount: 1 });
  const verification = evidence(environment, {
    kind: 'deprecated-fixture',
    blockName: probe.name,
    inputHash: probe.inputMarkupHash,
    outputHash: probe.currentMarkupHash,
    stages: [
      stage('migrate', probe.inputMarkupHash, migrationHash, {
        migrated: probe.migrated,
      }),
      stage('save', migrationHash, probe.currentMarkupHash),
      stage('parse', probe.currentMarkupHash, parseHash),
      stage('validate', parseHash, hashCanonical({
        valid: probe.valid,
        issues: probe.issues,
      })),
    ],
  });
  return {
    id: `deprecated:${probe.name}:${index}`,
    environmentId: environment.id,
    block,
    context: {},
    fixtureMarkup: probe.fixtureMarkup,
    markup: probe.currentMarkup,
    evidence: verification,
  };
}

function dynamicRecord(
  environment: ExactEnvironment,
  raw: unknown,
  index: number,
): VerifiedMarkupRecord {
  const probe = DynamicProbeSchema.parse(raw);
  if (probe.markupHash !== hashText(probe.markup)) {
    throw new Error(`Dynamic probe ${probe.name} markup hash mismatch`);
  }
  const block: RuntimeBlock = {
    name: probe.name,
    attributes: probe.attributes,
    innerBlocks: [],
  };
  const context = {};
  const inputHash = hashCanonical({ block, context });
  const verification = evidence(environment, {
    kind: 'dynamic-server-render',
    blockName: probe.name,
    inputHash,
    outputHash: probe.markupHash,
    stages: [
      stage('server-render', inputHash, probe.markupHash, {
        callbackExecuted: true,
      }),
    ],
  });
  return {
    id: `dynamic:${probe.name}:${index}`,
    environmentId: environment.id,
    block,
    context,
    fixtureMarkup: null,
    markup: probe.markup,
    evidence: verification,
  };
}

export function sealRecordedVerifications(
  input: RecordedVerificationInputs,
): VerifiedMarkupBundle {
  const environment = ExactEnvironmentSchema.parse(input.environment);
  const records = [
    ...(input.staticProbes ?? []).map((probe, index) =>
      staticRecord(environment, probe, index)),
    ...(input.deprecatedProbes ?? []).map((probe, index) =>
      deprecatedRecord(environment, probe, index)),
    ...(input.dynamicProbes ?? []).map((probe, index) =>
      dynamicRecord(environment, probe, index)),
  ];
  return VerifiedMarkupBundleSchema.parse({
    schemaVersion: 1,
    records,
  });
}
