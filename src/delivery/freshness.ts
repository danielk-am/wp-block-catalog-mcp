import { z } from 'zod';

import { CatalogArtifactSchema } from '../schema.js';

export const FreshnessPolicySchema = z.object({
  maxAgeSeconds: z.number().finite().nonnegative().nullable(),
  maxFutureSkewSeconds: z.number().finite().nonnegative().default(300),
});

export type FreshnessPolicy = z.input<typeof FreshnessPolicySchema>;

export const FreshnessResultSchema = z.object({
  status: z.enum([ 'fresh', 'stale', 'future' ]),
  fresh: z.boolean(),
  generatedAt: z.string().datetime(),
  checkedAt: z.string().datetime(),
  ageSeconds: z.number().finite(),
  maxAgeSeconds: z.number().finite().nonnegative().nullable(),
  maxFutureSkewSeconds: z.number().finite().nonnegative(),
});

export type FreshnessResult = z.infer<typeof FreshnessResultSchema>;

export function checkArtifactFreshness(
  input: unknown,
  policyInput: FreshnessPolicy,
  now: Date = new Date(),
): FreshnessResult {
  const artifact = CatalogArtifactSchema.parse(input);
  const policy = FreshnessPolicySchema.parse(policyInput);
  if (Number.isNaN(now.getTime())) {
    throw new Error('Freshness check requires a valid current time');
  }

  const generatedAt = new Date(artifact.generatedAt);
  const ageSeconds = (now.getTime() - generatedAt.getTime()) / 1000;
  let status: FreshnessResult['status'] = 'fresh';
  if (ageSeconds < -policy.maxFutureSkewSeconds) {
    status = 'future';
  } else if (
    policy.maxAgeSeconds !== null &&
    ageSeconds > policy.maxAgeSeconds
  ) {
    status = 'stale';
  }

  return FreshnessResultSchema.parse({
    status,
    fresh: status === 'fresh',
    generatedAt: artifact.generatedAt,
    checkedAt: now.toISOString(),
    ageSeconds,
    maxAgeSeconds: policy.maxAgeSeconds,
    maxFutureSkewSeconds: policy.maxFutureSkewSeconds,
  });
}

export function assertArtifactFresh(
  input: unknown,
  policy: FreshnessPolicy,
  now: Date = new Date(),
): FreshnessResult {
  const result = checkArtifactFreshness(input, policy, now);
  if (!result.fresh) {
    throw new Error(
      `Catalogue artefact freshness gate failed: ${result.status} ` +
      `(age ${result.ageSeconds}s)`,
    );
  }
  return result;
}
