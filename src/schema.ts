import { z } from 'zod';

export const ProductSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/);

export const ChannelSchema = z.enum([
  'stable',
  'prerelease',
  'trunk',
  'deploy',
]);

export const VisibilitySchema = z.enum([ 'public', 'private' ]);

export const SourceManifestSchema = z.object({
  id: z.string().min(1),
  adapter: z.string().min(1),
  product: ProductSchema,
  productVersion: z.string().min(1),
  channel: ChannelSchema,
  visibility: VisibilitySchema,
  repository: z.string().url(),
  ref: z.string().min(1),
  commit: z.string().regex(/^[0-9a-f]{40}$/i),
  include: z.array(z.string().min(1)).min(1),
  exclude: z.array(z.string().min(1)).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type SourceManifest = z.infer<typeof SourceManifestSchema>;

export const EnvironmentLayerSchema = z.object({
  sourceId: z.string().min(1),
  priority: z.number().int(),
});

export const EnvironmentSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  visibility: VisibilitySchema,
  layers: z.array(EnvironmentLayerSchema).min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type Environment = z.infer<typeof EnvironmentSchema>;

export const RelationshipKindSchema = z.enum([
  'parent',
  'ancestor',
  'allows_child',
  'provides_context',
  'uses_context',
  'block_hook',
  'transform_to',
  'transform_from',
  'variation_of',
  'deprecated_from',
]);

export const RelationshipSchema = z.object({
  kind: RelationshipKindSchema,
  target: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type Relationship = z.infer<typeof RelationshipSchema>;

export const VerificationLevelSchema = z.enum([
  'metadata-only',
  'runtime-observed',
  'structurally-valid',
  'save-runtime-valid',
  'deprecated-fixture-valid',
  'server-render-valid',
]);

export const ProvenanceSchema = z
  .object({
    kind: z.enum([ 'source', 'runtime-capture' ]).optional(),
    repository: z.string().url().nullable(),
    ref: z.string().min(1).nullable(),
    commit: z.string().regex(/^[0-9a-f]{40}$/i).nullable(),
    path: z.string().min(1),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/i),
    capturedAt: z.string().datetime().optional(),
    captureMethod: z.literal('runtime-registry-snapshot').optional(),
  })
  .superRefine((provenance, context) => {
    if (provenance.kind === 'runtime-capture') {
      if (
        provenance.repository !== null ||
        provenance.ref !== null ||
        provenance.commit !== null ||
        !provenance.capturedAt ||
        !provenance.captureMethod
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'Runtime capture provenance cannot claim source repository identity',
        });
      }
      return;
    }

    if (
      provenance.repository === null ||
      provenance.ref === null ||
      provenance.commit === null ||
      provenance.capturedAt ||
      provenance.captureMethod
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Source provenance requires repository, ref, and commit only',
      });
    }
  });

export const RuntimePromotionProvenanceSchema = z
  .object({
    kind: z.literal('deployment-registry'),
    environmentId: z.string().min(1),
    observation: z
      .object({
        serverCapturedAt: z.string().datetime(),
        clientCapturedAt: z.string().datetime().nullable(),
      })
      .strict(),
    profileHash: z.string().regex(/^[0-9a-f]{64}$/i),
    serverRegistryHash: z.string().regex(/^[0-9a-f]{64}$/i),
    clientRegistryHash: z.string().regex(/^[0-9a-f]{64}$/i).nullable(),
    origins: z.array(z.enum([ 'server', 'client' ])).min(1),
  })
  .strict();

export type RuntimePromotionProvenance = z.infer<
  typeof RuntimePromotionProvenanceSchema
>;

export const AvailabilityStateSchema = z.enum([
  'unknown',
  'included',
  'gated',
  'excluded',
  'removed',
]);

export const AvailabilitySchema = z.object({
  sourcePresent: z.boolean(),
  includedInBuild: z.boolean().nullable(),
  serverRegistered: z.boolean().nullable(),
  clientRegistered: z.boolean().nullable(),
  inserterVisible: z.boolean().nullable(),
  editorSurfaces: z.array(z.string()),
  experimental: z.union([ z.boolean(), z.string() ]).nullable(),
  gates: z.array(z.string()),
  state: AvailabilityStateSchema,
});

export const BlockDefinitionSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  product: ProductSchema,
  productVersion: z.string().min(1),
  name: z.string().regex(/^[a-z][a-z0-9-]*\/[a-z0-9-]+$/),
  title: z.string().nullable(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  apiVersion: z.number().int().positive().nullable(),
  keywords: z.array(z.string()),
  attributes: z.record(z.string(), z.unknown()),
  supports: z.record(z.string(), z.unknown()),
  availability: AvailabilitySchema,
  relationships: z.array(RelationshipSchema),
  variations: z.array(z.record(z.string(), z.unknown())),
  rawMetadata: z.record(z.string(), z.unknown()),
  verification: z.array(VerificationLevelSchema).min(1),
  visibility: VisibilitySchema,
  provenance: ProvenanceSchema,
  runtimeProvenance: RuntimePromotionProvenanceSchema.optional(),
});

export type BlockDefinition = z.infer<typeof BlockDefinitionSchema>;

export const CatalogArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  catalogVersion: z.string().min(1),
  generatedAt: z.string().datetime(),
  sources: z.array(SourceManifestSchema),
  environments: z.array(EnvironmentSchema),
  blocks: z.array(BlockDefinitionSchema),
});

export type CatalogArtifact = z.infer<typeof CatalogArtifactSchema>;

export const BuildSourceSchema = z.object({
  manifest: z.string().min(1),
  checkout: z.string().min(1),
});

export const BuildConfigSchema = z.object({
  catalogVersion: z.string().min(1),
  visibility: VisibilitySchema,
  output: z.string().min(1),
  sources: z.array(BuildSourceSchema).min(1),
  environments: z.array(EnvironmentSchema).default([]),
  environmentFiles: z.array(z.string().min(1)).default([]),
}).refine(
  ({ environments, environmentFiles }) =>
    environments.length + environmentFiles.length > 0,
  {
    message: 'At least one inline environment or environment file is required',
  },
);

export type BuildConfig = z.infer<typeof BuildConfigSchema>;
