import { z } from 'zod';

import type { Catalog } from '../catalog.js';
import {
  BlockDefinitionSchema,
} from '../schema.js';
import type {
  BlockDefinition,
  Relationship,
} from '../schema.js';
import { deterministicHash } from './hash.js';
import {
  RuntimeReconciliationSchema,
} from './schema.js';
import type {
  ClientRuntimeSnapshot,
  ServerRuntimeSnapshot,
} from './schema.js';
import {
  parseClientRuntimeSnapshot,
  parseServerRuntimeSnapshot,
} from './snapshot.js';
import { reconcileRuntime } from './reconcile.js';

export const RuntimeReconciliationBundleSchema = z.object({
  schemaVersion: z.literal(1),
  environmentId: z.string().min(1),
  profileHash: z.string().regex(/^[0-9a-f]{64}$/),
  serverRegistryHash: z.string().regex(/^[0-9a-f]{64}$/),
  clientRegistryHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  serverCapturedAt: z.string().datetime().optional(),
  clientCapturedAt: z.string().datetime().nullable().optional(),
  promotedDefinitions: z.array(BlockDefinitionSchema).default([]),
  reconciliations: z.array(RuntimeReconciliationSchema),
  serverOnly: z.array(z.string()),
  clientOnly: z.array(z.string()),
  sourceOnly: z.array(z.string()),
}).superRefine((bundle, context) => {
  for (const [ index, definition ] of bundle.promotedDefinitions.entries()) {
    const runtime = definition.runtimeProvenance;
    if (
      definition.visibility !== 'private' ||
      !runtime ||
      runtime.environmentId !== bundle.environmentId ||
      definition.sourceId !==
        `runtime-observed:${bundle.environmentId}` ||
      definition.product !== 'runtime-observed' ||
      definition.provenance.kind !== 'runtime-capture'
    ) {
      context.addIssue({
        code: 'custom',
        path: [ 'promotedDefinitions', index ],
        message:
          'Promoted runtime definitions must be private and scoped to the bundle environment',
      });
      continue;
    }
    if (
      runtime.profileHash !== bundle.profileHash ||
      runtime.serverRegistryHash !== bundle.serverRegistryHash ||
      runtime.clientRegistryHash !== bundle.clientRegistryHash ||
      runtime.observation.serverCapturedAt !== bundle.serverCapturedAt ||
      runtime.observation.clientCapturedAt !== bundle.clientCapturedAt ||
      definition.provenance.capturedAt !==
        (runtime.observation.clientCapturedAt ??
          runtime.observation.serverCapturedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: [ 'promotedDefinitions', index, 'runtimeProvenance' ],
        message:
          'Promoted runtime definition provenance must match its observation and bundle hashes',
      });
    }
    const reconciliation = bundle.reconciliations.find(
      ({ name, source }) =>
        name === definition.name && source.id === definition.id,
    );
    if (!reconciliation) {
      context.addIssue({
        code: 'custom',
        path: [ 'promotedDefinitions', index ],
        message:
          'Promoted runtime definition requires a matching reconciliation',
      });
    }
  }
});

export type RuntimeReconciliationBundle = z.infer<
  typeof RuntimeReconciliationBundleSchema
>;

function difference(left: Set<string>, right: Set<string>): string[] {
  return [ ...left ]
    .filter((name) => !right.has(name))
    .sort((a, b) => a.localeCompare(b));
}

function runtimeRelationships(
  server: ServerRuntimeSnapshot['blocks'][number] | null,
  client: ClientRuntimeSnapshot['blocks'][number] | null,
): Relationship[] {
  const block = client ?? server;
  if (!block) {
    return [];
  }

  const relationships: Relationship[] = [
    ...block.parent.map((target) => ({
      kind: 'parent' as const,
      target,
      metadata: {},
    })),
    ...block.ancestor.map((target) => ({
      kind: 'ancestor' as const,
      target,
      metadata: {},
    })),
    ...block.allowedBlocks.map((target) => ({
      kind: 'allows_child' as const,
      target,
      metadata: {},
    })),
    ...Object.entries(block.providesContext).map(([ target, attribute ]) => ({
      kind: 'provides_context' as const,
      target,
      metadata: { attribute },
    })),
    ...block.usesContext.map((target) => ({
      kind: 'uses_context' as const,
      target,
      metadata: {},
    })),
    ...Object.entries(block.blockHooks).map(([ target, position ]) => ({
      kind: 'block_hook' as const,
      target,
      metadata: { position },
    })),
  ];

  if (client) {
    relationships.push(
      ...client.transforms.from.flatMap((transform) =>
        transform.blockNames.map((target) => ({
          kind: 'transform_from' as const,
          target,
          metadata: {
            type: transform.type,
            priority: transform.priority,
          },
        }))),
      ...client.transforms.to.flatMap((transform) =>
        transform.blockNames.map((target) => ({
          kind: 'transform_to' as const,
          target,
          metadata: {
            type: transform.type,
            priority: transform.priority,
          },
        }))),
      ...client.deprecations.map((deprecation) => ({
        kind: 'deprecated_from' as const,
        target: `${client.name}@${deprecation.index}`,
        metadata: { index: deprecation.index },
      })),
    );
  }

  return relationships;
}

function promoteRuntimeDefinitions(
  catalog: Catalog,
  environmentId: string,
  server: ServerRuntimeSnapshot,
  client: ClientRuntimeSnapshot | null,
  sourceNames: Set<string>,
): BlockDefinition[] {
  const environment = catalog.artifact.environments
    .find(({ id }) => id === environmentId);
  if (!environment || environment.visibility !== 'private') {
    return [];
  }
  const sourceId = `runtime-observed:${environmentId}`;

  const serverByName = new Map(server.blocks.map((block) => [ block.name, block ]));
  const clientByName = new Map(
    (client?.blocks ?? []).map((block) => [ block.name, block ]),
  );
  const runtimeOnlyNames = new Set([
    ...difference(new Set(serverByName.keys()), sourceNames),
    ...difference(new Set(clientByName.keys()), sourceNames),
  ]);

  return [ ...runtimeOnlyNames ]
    .sort((left, right) => left.localeCompare(right))
    .map((name) => {
      const serverBlock = serverByName.get(name) ?? null;
      const clientBlock = clientByName.get(name) ?? null;
      const effective = clientBlock ?? serverBlock;
      if (!effective) {
        throw new Error(`Runtime-only block ${name} has no registry origin`);
      }
      const origins = [
        ...(serverBlock ? [ 'server' as const ] : []),
        ...(clientBlock ? [ 'client' as const ] : []),
      ];
      const runtimeProvenance = {
        kind: 'deployment-registry' as const,
        environmentId,
        observation: {
          serverCapturedAt: server.capturedAt,
          clientCapturedAt: client?.capturedAt ?? null,
        },
        profileHash: server.profileHash,
        serverRegistryHash: server.registryHash,
        clientRegistryHash: client?.registryHash ?? null,
        origins,
      };
      const contentHash = deterministicHash({
        runtimeProvenance,
        server: serverBlock,
        client: clientBlock,
      });

      return BlockDefinitionSchema.parse({
        id: `${sourceId}:${name}`,
        sourceId,
        product: 'runtime-observed',
        productVersion: server.capturedAt.slice(0, 10),
        name,
        title: null,
        description: null,
        category: null,
        apiVersion: effective.apiVersion,
        keywords: [],
        attributes: effective.attributes,
        supports: effective.supports,
        availability: {
          sourcePresent: false,
          includedInBuild: true,
          serverRegistered: serverBlock !== null,
          clientRegistered: client ? clientBlock !== null : null,
          inserterVisible: client ? clientBlock?.inserterVisible ?? null : null,
          editorSurfaces: clientBlock ? [ server.profile.editorSurface ] : [],
          experimental: null,
          gates: [],
          state: 'included',
        },
        relationships: runtimeRelationships(serverBlock, clientBlock),
        variations: effective.variations,
        rawMetadata: {
          name,
          runtimeOnly: true,
        },
        verification: [ 'runtime-observed' ],
        visibility: 'private',
        provenance: {
          kind: 'runtime-capture',
          repository: null,
          ref: null,
          commit: null,
          path: `runtime-registry/${environmentId}/${name}`,
          contentHash,
          capturedAt: client?.capturedAt ?? server.capturedAt,
          captureMethod: 'runtime-registry-snapshot',
        },
        runtimeProvenance,
      });
    });
}

export function createRuntimeReconciliationBundle(
  catalog: Catalog,
  environmentId: string,
  serverInput: unknown,
  clientInput?: unknown,
): RuntimeReconciliationBundle {
  const server = parseServerRuntimeSnapshot(serverInput);
  const client =
    clientInput === undefined || clientInput === null
      ? null
      : parseClientRuntimeSnapshot(clientInput);
  if (
    server.profile.environmentId !== environmentId ||
    (client && (
      server.profileHash !== client.profileHash ||
      client.profile.environmentId !== environmentId
    ))
  ) {
    throw new Error(
      'Server and client snapshots must share the requested runtime profile',
    );
  }

  const sourceNames = new Set<string>();
  for (const block of catalog.artifact.blocks) {
    if (catalog.resolve(block.name, environmentId)) {
      sourceNames.add(block.name);
    }
  }
  const serverNames = new Set(server.blocks.map(({ name }) => name));
  const clientNames = new Set(
    (client?.blocks ?? []).map(({ name }) => name),
  );
  const promotedDefinitions = promoteRuntimeDefinitions(
    catalog,
    environmentId,
    server,
    client,
    sourceNames,
  );
  const promotedByName = new Map(
    promotedDefinitions.map((definition) => [ definition.name, definition ]),
  );

  const reconciliations = [ ...new Set([
    ...sourceNames,
    ...promotedByName.keys(),
  ]) ]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const definition =
        promotedByName.get(name) ??
        catalog.resolve(name, environmentId)?.definition;
      if (!definition) {
        throw new Error(`Could not resolve ${name} in ${environmentId}`);
      }
      return reconcileRuntime({
        source: definition,
        profile: server.profile,
        server,
        client,
      });
    });

  return RuntimeReconciliationBundleSchema.parse({
    schemaVersion: 1,
    environmentId,
    profileHash: server.profileHash,
    serverRegistryHash: server.registryHash,
    clientRegistryHash: client?.registryHash ?? null,
    serverCapturedAt: server.capturedAt,
    clientCapturedAt: client?.capturedAt ?? null,
    promotedDefinitions,
    reconciliations,
    serverOnly: difference(serverNames, sourceNames),
    clientOnly: difference(clientNames, sourceNames),
    sourceOnly: difference(
      sourceNames,
      new Set([ ...serverNames, ...clientNames ]),
    ),
  });
}

export class RuntimeBundleStore {
  private readonly bundles: Map<string, RuntimeReconciliationBundle>;
  private readonly promotedDefinitions: BlockDefinition[];

  constructor(inputs: unknown[] = []) {
    this.bundles = new Map();
    this.promotedDefinitions = [];
    for (const input of inputs) {
      const bundle = RuntimeReconciliationBundleSchema.parse(input);
      if (this.bundles.has(bundle.environmentId)) {
        throw new Error(
          `Duplicate runtime bundle for ${bundle.environmentId}`,
        );
      }
      this.bundles.set(bundle.environmentId, bundle);
      this.promotedDefinitions.push(...bundle.promotedDefinitions);
    }
  }

  get(
    environmentId: string,
    blockName: string,
  ): RuntimeReconciliationBundle['reconciliations'][number] | null {
    return this.bundles.get(environmentId)?.reconciliations
      .find(({ name }) => name === blockName) ?? null;
  }

  bundle(environmentId: string): RuntimeReconciliationBundle | null {
    return this.bundles.get(environmentId) ?? null;
  }

  definitions(): BlockDefinition[] {
    return [ ...this.promotedDefinitions ];
  }
}
