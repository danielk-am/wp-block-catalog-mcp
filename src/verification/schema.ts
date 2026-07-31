import { z } from 'zod';

import { hashCanonical } from './hash.js';

export const EvidenceHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const CommitHashSchema = z.string().regex(/^[0-9a-f]{40}$/i);
export const BlockNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*\/[a-z0-9-]+$/);

export const ExactEnvironmentSourceSchema = z
  .object({
    sourceId: z.string().min(1),
    productVersion: z.string().min(1),
    commit: CommitHashSchema,
  })
  .strict();

export const ExactRuntimeComponentSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    artifactHash: EvidenceHashSchema,
  })
  .strict();

export const ExactEnvironmentSchema = z
  .object({
    id: z.string().min(1),
    wordpressVersion: z.string().min(1),
    phpVersion: z.string().min(1).nullable(),
    locale: z.string().min(1),
    timezone: z.string().min(1),
    sources: z.array(ExactEnvironmentSourceSchema).min(1),
    runtimeComponents: z.array(ExactRuntimeComponentSchema).min(1),
  })
  .strict();

export type ExactEnvironment = z.infer<typeof ExactEnvironmentSchema>;

export function hashExactEnvironment(environment: ExactEnvironment): string {
  return hashCanonical(ExactEnvironmentSchema.parse(environment));
}

export const VerificationKindSchema = z.enum([
  'static-save',
  'deprecated-fixture',
  'dynamic-server-render',
]);

export type VerificationKind = z.infer<typeof VerificationKindSchema>;

export const RuntimeVerificationLabelSchema = z.enum([
  'save-runtime-valid',
  'deprecated-fixture-valid',
  'server-render-valid',
]);

export type RuntimeVerificationLabel = z.infer<
  typeof RuntimeVerificationLabelSchema
>;

export const VerificationStatusSchema = z.enum([
  'passed',
  'failed',
  'drift',
]);

export const VerificationStageNameSchema = z.enum([
  'environment',
  'save',
  'parse',
  'validate',
  'migrate',
  'server-render',
]);

export type VerificationStageName = z.infer<
  typeof VerificationStageNameSchema
>;

export const VerificationStageSchema = z
  .object({
    name: VerificationStageNameSchema,
    status: z.enum([ 'success', 'failed' ]),
    inputHash: EvidenceHashSchema,
    outputHash: EvidenceHashSchema.nullable(),
    details: z.record(z.string(), z.unknown()),
  })
  .strict();

export const VerificationFailureSchema = z
  .object({
    stage: VerificationStageNameSchema,
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

const expectedLabelByKind: Record<
  VerificationKind,
  RuntimeVerificationLabel
> = {
  'static-save': 'save-runtime-valid',
  'deprecated-fixture': 'deprecated-fixture-valid',
  'dynamic-server-render': 'server-render-valid',
};

const VerificationEvidencePayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: VerificationKindSchema,
    blockName: BlockNameSchema,
    status: VerificationStatusSchema,
    labelsGranted: z.array(RuntimeVerificationLabelSchema).max(1),
    expectedEnvironment: ExactEnvironmentSchema,
    expectedEnvironmentHash: EvidenceHashSchema,
    observedEnvironmentBefore: ExactEnvironmentSchema.nullable(),
    observedEnvironmentAfter: ExactEnvironmentSchema.nullable(),
    inputHash: EvidenceHashSchema,
    outputHash: EvidenceHashSchema.nullable(),
    stages: z.array(VerificationStageSchema),
    failure: VerificationFailureSchema.nullable(),
  })
  .strict()
  .superRefine((evidence, context) => {
    const expectedEnvironmentHash = hashExactEnvironment(
      evidence.expectedEnvironment,
    );
    if (evidence.expectedEnvironmentHash !== expectedEnvironmentHash) {
      context.addIssue({
        code: 'custom',
        message: 'expectedEnvironmentHash does not match expectedEnvironment',
        path: [ 'expectedEnvironmentHash' ],
      });
    }

    if (evidence.status === 'passed') {
      const expectedLabel = expectedLabelByKind[evidence.kind];
      if (
        evidence.labelsGranted.length !== 1 ||
        evidence.labelsGranted[0] !== expectedLabel ||
        evidence.failure !== null
      ) {
        context.addIssue({
          code: 'custom',
          message: `Passed ${evidence.kind} evidence must grant only ${expectedLabel}`,
          path: [ 'labelsGranted' ],
        });
      }
      return;
    }

    if (evidence.labelsGranted.length > 0) {
      context.addIssue({
        code: 'custom',
        message: 'Failed or drifted evidence cannot grant verification labels',
        path: [ 'labelsGranted' ],
      });
    }
    if (evidence.failure === null) {
      context.addIssue({
        code: 'custom',
        message: 'Failed or drifted evidence must describe the failure',
        path: [ 'failure' ],
      });
    }
  });

export const VerificationEvidenceSchema =
  VerificationEvidencePayloadSchema.extend({
    evidenceHash: EvidenceHashSchema,
  })
    .strict()
    .superRefine((evidence, context) => {
      const { evidenceHash, ...payload } = evidence;
      if (evidenceHash !== hashCanonical(payload)) {
        context.addIssue({
          code: 'custom',
          message: 'evidenceHash does not match evidence payload',
          path: [ 'evidenceHash' ],
        });
      }
    });

export type VerificationEvidencePayload = z.infer<
  typeof VerificationEvidencePayloadSchema
>;
export type VerificationEvidence = z.infer<
  typeof VerificationEvidenceSchema
>;

export function sealEvidence(
  payload: VerificationEvidencePayload,
): VerificationEvidence {
  const parsed = VerificationEvidencePayloadSchema.parse(payload);
  return VerificationEvidenceSchema.parse({
    ...parsed,
    evidenceHash: hashCanonical(parsed),
  });
}
