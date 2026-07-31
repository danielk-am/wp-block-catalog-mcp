import { z } from 'zod';

import {
  DeliveryVisibilitySchema,
  FreshnessPolicySchema,
  FreshnessResultSchema,
  checkArtifactFreshness,
  hashArtifact,
  prepareDeliveryArtifact,
  stableStringify,
} from '../delivery/index.js';
import type {
  DeliveryVisibility,
  FreshnessPolicy,
  FreshnessResult,
} from '../delivery/index.js';
import type {
  BlockDefinition,
  CatalogArtifact,
} from '../schema.js';

const StringListSchema = z.array(z.string());

export const ReleaseDiffSummarySchema = z.object({
  previousHash: z.string().regex(/^[0-9a-f]{64}$/),
  nextHash: z.string().regex(/^[0-9a-f]{64}$/),
  addedSources: StringListSchema,
  removedSources: StringListSchema,
  addedEnvironments: StringListSchema,
  removedEnvironments: StringListSchema,
  addedDefinitions: StringListSchema,
  removedDefinitions: StringListSchema,
  changedDefinitions: StringListSchema,
  addedBlockNames: StringListSchema,
  removedBlockNames: StringListSchema,
  counts: z.object({
    sources: z.object({
      previous: z.number().int().nonnegative(),
      next: z.number().int().nonnegative(),
    }),
    environments: z.object({
      previous: z.number().int().nonnegative(),
      next: z.number().int().nonnegative(),
    }),
    definitions: z.object({
      previous: z.number().int().nonnegative(),
      next: z.number().int().nonnegative(),
    }),
    blockNames: z.object({
      previous: z.number().int().nonnegative(),
      next: z.number().int().nonnegative(),
    }),
  }),
});

export type ReleaseDiffSummary = z.infer<typeof ReleaseDiffSummarySchema>;

function sortedDifference(left: Set<string>, right: Set<string>): string[] {
  return [ ...left ]
    .filter((value) => !right.has(value))
    .sort((a, b) => a.localeCompare(b));
}

function mapBlocks(
  artifact: CatalogArtifact,
): Map<string, BlockDefinition> {
  return new Map(artifact.blocks.map((block) => [ block.id, block ]));
}

export function summarizeReleaseDiff(
  previousInput: unknown,
  nextInput: unknown,
  visibility: DeliveryVisibility,
): ReleaseDiffSummary {
  const previous = prepareDeliveryArtifact(previousInput, visibility);
  const next = prepareDeliveryArtifact(nextInput, visibility);

  const previousSources = new Set(previous.sources.map(({ id }) => id));
  const nextSources = new Set(next.sources.map(({ id }) => id));
  const previousEnvironments = new Set(
    previous.environments.map(({ id }) => id),
  );
  const nextEnvironments = new Set(next.environments.map(({ id }) => id));
  const previousBlocks = mapBlocks(previous);
  const nextBlocks = mapBlocks(next);
  const previousDefinitions = new Set(previousBlocks.keys());
  const nextDefinitions = new Set(nextBlocks.keys());
  const previousNames = new Set(previous.blocks.map(({ name }) => name));
  const nextNames = new Set(next.blocks.map(({ name }) => name));
  const changedDefinitions = [ ...previousDefinitions ]
    .filter((id) => {
      const before = previousBlocks.get(id);
      const after = nextBlocks.get(id);
      return (
        before !== undefined &&
        after !== undefined &&
        stableStringify(before) !== stableStringify(after)
      );
    })
    .sort((left, right) => left.localeCompare(right));

  return ReleaseDiffSummarySchema.parse({
    previousHash: hashArtifact(previous),
    nextHash: hashArtifact(next),
    addedSources: sortedDifference(nextSources, previousSources),
    removedSources: sortedDifference(previousSources, nextSources),
    addedEnvironments: sortedDifference(
      nextEnvironments,
      previousEnvironments,
    ),
    removedEnvironments: sortedDifference(
      previousEnvironments,
      nextEnvironments,
    ),
    addedDefinitions: sortedDifference(
      nextDefinitions,
      previousDefinitions,
    ),
    removedDefinitions: sortedDifference(
      previousDefinitions,
      nextDefinitions,
    ),
    changedDefinitions,
    addedBlockNames: sortedDifference(nextNames, previousNames),
    removedBlockNames: sortedDifference(previousNames, nextNames),
    counts: {
      sources: {
        previous: previousSources.size,
        next: nextSources.size,
      },
      environments: {
        previous: previousEnvironments.size,
        next: nextEnvironments.size,
      },
      definitions: {
        previous: previousDefinitions.size,
        next: nextDefinitions.size,
      },
      blockNames: {
        previous: previousNames.size,
        next: nextNames.size,
      },
    },
  });
}

export const RemovalExplanationSchema = z.object({
  kind: z.enum([ 'block', 'source', 'environment', 'definition' ]),
  key: z.string().min(1),
  reason: z.string().trim().min(8),
});

export type RemovalExplanation = z.infer<
  typeof RemovalExplanationSchema
>;

export const ReleaseGatePolicySchema = z.object({
  visibility: DeliveryVisibilitySchema,
  freshness: FreshnessPolicySchema,
  removalExplanations: z.array(RemovalExplanationSchema).default([]),
});

export type ReleaseGatePolicy = {
  visibility: DeliveryVisibility;
  freshness: FreshnessPolicy;
  removalExplanations?: RemovalExplanation[];
};

export const ReleaseGateResultSchema = z.object({
  passed: z.boolean(),
  summary: ReleaseDiffSummarySchema,
  freshness: FreshnessResultSchema,
  unexplainedRemovals: z.array(z.object({
    kind: z.enum([ 'block', 'source', 'environment', 'definition' ]),
    key: z.string(),
  })),
  violations: z.array(z.string()),
});

export type ReleaseGateResult = z.infer<typeof ReleaseGateResultSchema>;

function explanationKey(kind: RemovalExplanation['kind'], key: string): string {
  return `${kind}:${key}`;
}

function definitionSourceId(
  artifact: CatalogArtifact,
  definitionId: string,
): string | undefined {
  return artifact.blocks.find(({ id }) => id === definitionId)?.sourceId;
}

function definitionName(
  artifact: CatalogArtifact,
  definitionId: string,
): string | undefined {
  return artifact.blocks.find(({ id }) => id === definitionId)?.name;
}

function unexplainedRemovals(
  previousInput: unknown,
  summary: ReleaseDiffSummary,
  visibility: DeliveryVisibility,
  explanations: RemovalExplanation[],
): ReleaseGateResult['unexplainedRemovals'] {
  const previous = prepareDeliveryArtifact(previousInput, visibility);
  const explained = new Set(
    explanations.map(({ kind, key }) => explanationKey(kind, key)),
  );
  const unexplained: ReleaseGateResult['unexplainedRemovals'] = [];

  for (const key of summary.removedSources) {
    if (!explained.has(explanationKey('source', key))) {
      unexplained.push({ kind: 'source', key });
    }
  }
  for (const key of summary.removedEnvironments) {
    if (!explained.has(explanationKey('environment', key))) {
      unexplained.push({ kind: 'environment', key });
    }
  }
  for (const key of summary.removedBlockNames) {
    if (!explained.has(explanationKey('block', key))) {
      const definitions = previous.blocks.filter(({ name }) => name === key);
      const coveredBySource = definitions.length > 0 && definitions.every(
        ({ sourceId }) => explained.has(explanationKey('source', sourceId)),
      );
      if (!coveredBySource) {
        unexplained.push({ kind: 'block', key });
      }
    }
  }
  for (const key of summary.removedDefinitions) {
    const sourceId = definitionSourceId(previous, key);
    const blockName = definitionName(previous, key);
    const covered =
      explained.has(explanationKey('definition', key)) ||
      (sourceId !== undefined &&
        explained.has(explanationKey('source', sourceId))) ||
      (blockName !== undefined &&
        explained.has(explanationKey('block', blockName)));
    if (!covered) {
      unexplained.push({ kind: 'definition', key });
    }
  }

  return unexplained.sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.key.localeCompare(right.key),
  );
}

export function evaluateReleaseGates(
  previousInput: unknown,
  nextInput: unknown,
  policyInput: ReleaseGatePolicy,
  now: Date = new Date(),
): ReleaseGateResult {
  const policy = ReleaseGatePolicySchema.parse(policyInput);
  const summary = summarizeReleaseDiff(
    previousInput,
    nextInput,
    policy.visibility,
  );
  const next = prepareDeliveryArtifact(nextInput, policy.visibility);
  const freshness: FreshnessResult = checkArtifactFreshness(
    next,
    policy.freshness,
    now,
  );
  const unexplained = unexplainedRemovals(
    previousInput,
    summary,
    policy.visibility,
    policy.removalExplanations,
  );
  const violations: string[] = [];
  if (!freshness.fresh) {
    violations.push(`Artefact freshness is ${freshness.status}`);
  }
  if (unexplained.length > 0) {
    violations.push(
      `${unexplained.length} removal(s) lack an explanation`,
    );
  }

  return ReleaseGateResultSchema.parse({
    passed: violations.length === 0,
    summary,
    freshness,
    unexplainedRemovals: unexplained,
    violations,
  });
}

export function assertReleaseReady(
  previousInput: unknown,
  nextInput: unknown,
  policy: ReleaseGatePolicy,
  now: Date = new Date(),
): ReleaseGateResult {
  const result = evaluateReleaseGates(
    previousInput,
    nextInput,
    policy,
    now,
  );
  if (!result.passed) {
    throw new Error(`Release gates failed: ${result.violations.join('; ')}`);
  }
  return result;
}
