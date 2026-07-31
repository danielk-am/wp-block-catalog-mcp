import { BlockDefinitionSchema } from '../schema.js';
import { deterministicHash } from './hash.js';
import {
  RuntimeProfileSchema,
  RuntimeReconciliationSchema,
} from './schema.js';
import type {
  ClientBlockSnapshot,
  ClientRuntimeSnapshot,
  JsonValue,
  RuntimeDrift,
  RuntimeOrigin,
  RuntimeProfile,
  RuntimeReconciliation,
  ServerBlockSnapshot,
  ServerRuntimeSnapshot,
} from './schema.js';
import {
  hashRuntimeProfile,
  parseClientRuntimeSnapshot,
  parseServerRuntimeSnapshot,
} from './snapshot.js';
import type { BlockDefinition, Relationship } from '../schema.js';

interface ProjectionValue {
  present: boolean;
  value: JsonValue;
}

type Projection = Map<string, ProjectionValue>;

function uniqueSorted(values: string[]): string[] {
  return [ ...new Set(values) ].sort();
}

function relationshipTargets(
  relationships: Relationship[],
  kind: Relationship['kind'],
): string[] {
  return uniqueSorted(
    relationships
      .filter((relationship) => relationship.kind === kind)
      .map((relationship) => relationship.target),
  );
}

function relationshipMap(
  relationships: Relationship[],
  kind: 'provides_context' | 'block_hook',
  metadataKey: 'attribute' | 'position',
): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {};
  for (const relationship of relationships) {
    if (relationship.kind !== kind) {
      continue;
    }
    const value = relationship.metadata[metadataKey];
    result[relationship.target] =
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
        ? value
        : null;
  }
  return result;
}

function variationNames(
  variations: Array<Record<string, unknown>>,
): string[] {
  return uniqueSorted(
    variations
      .map((variation) => variation.name)
      .filter((name): name is string => typeof name === 'string'),
  );
}

function sourceProjection(source: BlockDefinition): Projection {
  const result: Projection = new Map();
  result.set('registration', {
    present: true,
    value: source.availability.sourcePresent,
  });

  if (source.apiVersion !== null) {
    result.set('apiVersion', { present: true, value: source.apiVersion });
  }

  result.set('attributes', {
    present: true,
    value: source.attributes as JsonValue,
  });
  result.set('supports', {
    present: true,
    value: source.supports as JsonValue,
  });
  result.set('parent', {
    present: true,
    value: relationshipTargets(source.relationships, 'parent'),
  });
  result.set('ancestor', {
    present: true,
    value: relationshipTargets(source.relationships, 'ancestor'),
  });
  result.set('allowedBlocks', {
    present: true,
    value: relationshipTargets(source.relationships, 'allows_child'),
  });
  result.set('providesContext', {
    present: true,
    value: relationshipMap(
      source.relationships,
      'provides_context',
      'attribute',
    ),
  });
  result.set('usesContext', {
    present: true,
    value: relationshipTargets(source.relationships, 'uses_context'),
  });
  result.set('blockHooks', {
    present: true,
    value: relationshipMap(source.relationships, 'block_hook', 'position'),
  });
  result.set('variationNames', {
    present: true,
    value: variationNames(source.variations),
  });
  result.set('transformFrom', {
    present: true,
    value: relationshipTargets(source.relationships, 'transform_from'),
  });
  result.set('transformTo', {
    present: true,
    value: relationshipTargets(source.relationships, 'transform_to'),
  });
  result.set('deprecationCount', {
    present: true,
    value: source.relationships.filter(
      (relationship) => relationship.kind === 'deprecated_from',
    ).length,
  });

  return result;
}

function registryProjection(
  block: ServerBlockSnapshot | ClientBlockSnapshot | null,
): Projection {
  const result: Projection = new Map();
  result.set('registration', { present: true, value: block !== null });
  if (!block) {
    return result;
  }

  result.set('apiVersion', {
    present: block.apiVersion !== null,
    value: block.apiVersion,
  });
  result.set('attributes', { present: true, value: block.attributes });
  result.set('supports', { present: true, value: block.supports });
  result.set('parent', {
    present: true,
    value: uniqueSorted(block.parent),
  });
  result.set('ancestor', {
    present: true,
    value: uniqueSorted(block.ancestor),
  });
  result.set('allowedBlocks', {
    present: true,
    value: uniqueSorted(block.allowedBlocks),
  });
  result.set('providesContext', {
    present: true,
    value: block.providesContext,
  });
  result.set('usesContext', {
    present: true,
    value: uniqueSorted(block.usesContext),
  });
  result.set('blockHooks', {
    present: true,
    value: block.blockHooks,
  });
  result.set('variationNames', {
    present: true,
    value: uniqueSorted(block.variations.map((variation) => variation.name)),
  });

  if ('transforms' in block) {
    result.set('transformFrom', {
      present: true,
      value: uniqueSorted(
        block.transforms.from.flatMap((transform) => transform.blockNames),
      ),
    });
    result.set('transformTo', {
      present: true,
      value: uniqueSorted(
        block.transforms.to.flatMap((transform) => transform.blockNames),
      ),
    });
    result.set('deprecationCount', {
      present: true,
      value: block.deprecations.length,
    });
  }

  return result;
}

function driftSide(
  origin: RuntimeOrigin,
  value: ProjectionValue | undefined,
): RuntimeDrift['left'] {
  return {
    origin,
    present: value?.present ?? false,
    value: value?.value ?? null,
  };
}

function compareProjections(
  leftOrigin: RuntimeOrigin,
  left: Projection,
  rightOrigin: RuntimeOrigin,
  right: Projection,
): RuntimeDrift[] {
  const fields = uniqueSorted([ ...left.keys(), ...right.keys() ]);
  const drift: RuntimeDrift[] = [];

  for (const field of fields) {
    const leftValue = left.get(field);
    const rightValue = right.get(field);
    const leftPresent = leftValue?.present ?? false;
    const rightPresent = rightValue?.present ?? false;

    if (
      leftPresent === rightPresent &&
      (!leftPresent ||
        deterministicHash(leftValue?.value) ===
          deterministicHash(rightValue?.value))
    ) {
      continue;
    }

    drift.push({
      field,
      kind: !leftPresent
        ? 'missing-left'
        : !rightPresent
          ? 'missing-right'
          : 'mismatch',
      left: driftSide(leftOrigin, leftValue),
      right: driftSide(rightOrigin, rightValue),
    });
  }

  return drift;
}

function findServerBlock(
  snapshot: ServerRuntimeSnapshot | null,
  name: string,
): ServerBlockSnapshot | null {
  return snapshot?.blocks.find((block) => block.name === name) ?? null;
}

function findClientBlock(
  snapshot: ClientRuntimeSnapshot | null,
  name: string,
): ClientBlockSnapshot | null {
  return snapshot?.blocks.find((block) => block.name === name) ?? null;
}

function availability(
  source: BlockDefinition,
  profile: RuntimeProfile,
  serverObserved: boolean,
  server: ServerBlockSnapshot | null,
  clientObserved: boolean,
  client: ClientBlockSnapshot | null,
): BlockDefinition['availability'] {
  const serverRegistered = serverObserved
    ? server !== null
    : source.availability.serverRegistered;
  const clientRegistered = clientObserved
    ? client !== null
    : source.availability.clientRegistered;
  const includedInBuild =
    source.availability.includedInBuild ??
    (server !== null || client !== null ? true : null);
  const editorSurfaces = uniqueSorted([
    ...source.availability.editorSurfaces,
    ...(client ? [ profile.editorSurface ] : []),
  ]);

  let state = source.availability.state;
  if (serverRegistered === true || clientRegistered === true) {
    state = 'included';
  } else if (!source.availability.sourcePresent) {
    state = 'removed';
  } else if (includedInBuild === false) {
    state = 'excluded';
  } else if (
    source.availability.gates.length > 0 ||
    Boolean(source.availability.experimental) ||
    source.availability.state === 'gated'
  ) {
    state = 'gated';
  } else if (
    serverObserved &&
    clientObserved &&
    serverRegistered === false &&
    clientRegistered === false
  ) {
    state = 'excluded';
  }

  return {
    sourcePresent: source.availability.sourcePresent,
    includedInBuild,
    serverRegistered,
    clientRegistered,
    inserterVisible: clientObserved
      ? client
        ? client.inserterVisible
        : false
      : source.availability.inserterVisible,
    editorSurfaces,
    experimental: source.availability.experimental,
    gates: [ ...source.availability.gates ],
    state,
  };
}

export interface ReconcileRuntimeInput {
  source: BlockDefinition;
  profile: RuntimeProfile;
  server?: ServerRuntimeSnapshot | null;
  client?: ClientRuntimeSnapshot | null;
}

export function reconcileRuntime(
  input: ReconcileRuntimeInput,
): RuntimeReconciliation {
  const source = BlockDefinitionSchema.parse(input.source);
  const profile = RuntimeProfileSchema.parse(input.profile);
  const profileHash = hashRuntimeProfile(profile);
  const serverSnapshot = input.server
    ? parseServerRuntimeSnapshot(input.server)
    : null;
  const clientSnapshot = input.client
    ? parseClientRuntimeSnapshot(input.client)
    : null;

  if (
    serverSnapshot?.profileHash &&
    serverSnapshot.profileHash !== profileHash
  ) {
    throw new Error('Server snapshot belongs to a different runtime profile');
  }
  if (
    clientSnapshot?.profileHash &&
    clientSnapshot.profileHash !== profileHash
  ) {
    throw new Error('Client snapshot belongs to a different runtime profile');
  }

  const server = findServerBlock(serverSnapshot, source.name);
  const client = findClientBlock(clientSnapshot, source.name);
  const sourceView = sourceProjection(source);
  const serverView = registryProjection(server);
  const clientView = registryProjection(client);
  const drift = [
    ...(serverSnapshot
      ? compareProjections('source', sourceView, 'server', serverView)
      : []),
    ...(clientSnapshot
      ? compareProjections('source', sourceView, 'client', clientView)
      : []),
    ...(serverSnapshot && clientSnapshot
      ? compareProjections('server', serverView, 'client', clientView)
      : []),
  ];

  return RuntimeReconciliationSchema.parse({
    schemaVersion: 1,
    name: source.name,
    profile,
    profileHash,
    source,
    server,
    client,
    observed: {
      serverSnapshot: serverSnapshot !== null,
      clientSnapshot: clientSnapshot !== null,
    },
    availability: availability(
      source,
      profile,
      serverSnapshot !== null,
      server,
      clientSnapshot !== null,
      client,
    ),
    drift,
  });
}
