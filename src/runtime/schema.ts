import { z } from 'zod';

import {
  AvailabilitySchema,
  BlockDefinitionSchema,
} from '../schema.js';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

const BlockNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*\/[a-z0-9-]+$/);
const TransformBlockNameSchema = z.union([
  BlockNameSchema,
  z.literal('*'),
]);

export const RuntimeProfileSchema = z
  .object({
    environmentId: z.string().min(1),
    productVersions: z.record(z.string().min(1), z.string().min(1)),
    editorSurface: z.string().min(1),
    locale: z.string().min(1),
    theme: z
      .object({
        kind: z.string().min(1),
        slug: z.string().min(1).nullable(),
      })
      .strict(),
    featureFlags: JsonObjectSchema,
  })
  .strict();

export type RuntimeProfile = z.infer<typeof RuntimeProfileSchema>;

export const RuntimeVariationSchema = z
  .object({
    name: z.string().min(1),
    title: z.string().nullable(),
    scope: z.array(z.string()),
    isDefault: z.boolean(),
    attributes: JsonObjectSchema,
    innerBlocks: z.array(JsonValueSchema),
  })
  .strict();

export type RuntimeVariation = z.infer<typeof RuntimeVariationSchema>;

export const ServerCallbackPresenceSchema = z
  .object({
    render: z.boolean().nullable(),
  })
  .strict();

export const ClientCallbackPresenceSchema = z
  .object({
    edit: z.boolean(),
    save: z.boolean(),
  })
  .strict();

export const DeprecationCallbackPresenceSchema = z
  .object({
    save: z.boolean(),
    migrate: z.boolean(),
    isEligible: z.boolean(),
  })
  .strict();

export const TransformCallbackPresenceSchema = z
  .object({
    transform: z.boolean(),
    isMatch: z.boolean(),
  })
  .strict();

export const RuntimeTransformSchema = z
  .object({
    type: z.string().min(1),
    blockNames: z.array(TransformBlockNameSchema),
    priority: z.number().finite().nullable(),
    isMultiBlock: z.boolean().nullable(),
    callbacks: TransformCallbackPresenceSchema,
  })
  .strict();

export type RuntimeTransform = z.infer<typeof RuntimeTransformSchema>;

export const RuntimeDeprecationSchema = z
  .object({
    index: z.number().int().nonnegative(),
    attributes: JsonObjectSchema,
    supports: JsonObjectSchema,
    callbacks: DeprecationCallbackPresenceSchema,
  })
  .strict();

export type RuntimeDeprecation = z.infer<typeof RuntimeDeprecationSchema>;

const RegistryFields = {
  name: BlockNameSchema,
  apiVersion: z.number().int().positive().nullable(),
  attributes: JsonObjectSchema,
  supports: JsonObjectSchema,
  parent: z.array(BlockNameSchema),
  ancestor: z.array(BlockNameSchema),
  allowedBlocks: z.array(BlockNameSchema),
  providesContext: JsonObjectSchema,
  usesContext: z.array(z.string()),
  variations: z.array(RuntimeVariationSchema),
  blockHooks: z.record(z.string(), z.string()),
};

export const ServerBlockSnapshotSchema = z
  .object({
    ...RegistryFields,
    isDynamic: z.boolean(),
    callbacks: ServerCallbackPresenceSchema,
  })
  .strict();

export type ServerBlockSnapshot = z.infer<
  typeof ServerBlockSnapshotSchema
>;

export const ClientBlockSnapshotSchema = z
  .object({
    ...RegistryFields,
    inserterVisible: z.boolean().nullable(),
    transforms: z
      .object({
        from: z.array(RuntimeTransformSchema),
        to: z.array(RuntimeTransformSchema),
      })
      .strict(),
    deprecations: z.array(RuntimeDeprecationSchema),
    callbacks: ClientCallbackPresenceSchema,
  })
  .strict();

export type ClientBlockSnapshot = z.infer<
  typeof ClientBlockSnapshotSchema
>;

const SnapshotFields = {
  schemaVersion: z.literal(1),
  capturedAt: z.string().datetime(),
  profile: RuntimeProfileSchema,
  profileHash: z.string().regex(/^[0-9a-f]{64}$/),
  registryHash: z.string().regex(/^[0-9a-f]{64}$/),
};

export const ServerRuntimeSnapshotSchema = z
  .object({
    ...SnapshotFields,
    kind: z.literal('server'),
    blocks: z.array(ServerBlockSnapshotSchema),
  })
  .strict();

export type ServerRuntimeSnapshot = z.infer<
  typeof ServerRuntimeSnapshotSchema
>;

export const ClientRuntimeSnapshotSchema = z
  .object({
    ...SnapshotFields,
    kind: z.literal('client'),
    blocks: z.array(ClientBlockSnapshotSchema),
  })
  .strict();

export type ClientRuntimeSnapshot = z.infer<
  typeof ClientRuntimeSnapshotSchema
>;

export const RuntimeOriginSchema = z.enum([
  'source',
  'server',
  'client',
]);

export type RuntimeOrigin = z.infer<typeof RuntimeOriginSchema>;

export const RuntimeDriftSideSchema = z
  .object({
    origin: RuntimeOriginSchema,
    present: z.boolean(),
    value: JsonValueSchema,
  })
  .strict();

export const RuntimeDriftSchema = z
  .object({
    field: z.string().min(1),
    kind: z.enum([ 'missing-left', 'missing-right', 'mismatch' ]),
    left: RuntimeDriftSideSchema,
    right: RuntimeDriftSideSchema,
  })
  .strict();

export type RuntimeDrift = z.infer<typeof RuntimeDriftSchema>;

export const RuntimeReconciliationSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: BlockNameSchema,
    profile: RuntimeProfileSchema,
    profileHash: z.string().regex(/^[0-9a-f]{64}$/),
    source: BlockDefinitionSchema,
    server: ServerBlockSnapshotSchema.nullable(),
    client: ClientBlockSnapshotSchema.nullable(),
    observed: z
      .object({
        serverSnapshot: z.boolean(),
        clientSnapshot: z.boolean(),
      })
      .strict(),
    availability: AvailabilitySchema,
    drift: z.array(RuntimeDriftSchema),
  })
  .strict();

export type RuntimeReconciliation = z.infer<
  typeof RuntimeReconciliationSchema
>;
