import { deterministicHash } from './hash.js';
import {
  ClientBlockSnapshotSchema,
  ClientRuntimeSnapshotSchema,
  RuntimeProfileSchema,
  ServerBlockSnapshotSchema,
  ServerRuntimeSnapshotSchema,
} from './schema.js';
import type {
  ClientBlockSnapshot,
  ClientRuntimeSnapshot,
  RuntimeProfile,
  ServerBlockSnapshot,
  ServerRuntimeSnapshot,
} from './schema.js';

const HASH_PATTERN = /^[0-9a-f]{64}$/;

function sortedBlocks<T extends { name: string }>(blocks: T[]): T[] {
  const result = [ ...blocks ].sort((left, right) =>
    left.name.localeCompare(right.name),
  );

  for (let index = 1; index < result.length; index += 1) {
    if (result[index - 1]?.name === result[index]?.name) {
      throw new Error(`Duplicate runtime block: ${result[index]?.name}`);
    }
  }

  return result;
}

export function hashRuntimeProfile(profile: RuntimeProfile): string {
  return deterministicHash(RuntimeProfileSchema.parse(profile));
}

export function hashServerRegistry(
  profileHash: string,
  blocks: ServerBlockSnapshot[],
): string {
  if (!HASH_PATTERN.test(profileHash)) {
    throw new Error('Invalid runtime profile hash');
  }
  const parsed = blocks.map((block) => ServerBlockSnapshotSchema.parse(block));
  return deterministicHash({
    kind: 'server',
    profileHash,
    blocks: sortedBlocks(parsed),
  });
}

export function hashClientRegistry(
  profileHash: string,
  blocks: ClientBlockSnapshot[],
): string {
  if (!HASH_PATTERN.test(profileHash)) {
    throw new Error('Invalid runtime profile hash');
  }
  const parsed = blocks.map((block) => ClientBlockSnapshotSchema.parse(block));
  return deterministicHash({
    kind: 'client',
    profileHash,
    blocks: sortedBlocks(parsed),
  });
}

export interface CreateServerRuntimeSnapshotInput {
  capturedAt: string;
  profile: RuntimeProfile;
  blocks: ServerBlockSnapshot[];
}

export function createServerRuntimeSnapshot(
  input: CreateServerRuntimeSnapshotInput,
): ServerRuntimeSnapshot {
  const profile = RuntimeProfileSchema.parse(input.profile);
  const blocks = sortedBlocks(
    input.blocks.map((block) => ServerBlockSnapshotSchema.parse(block)),
  );
  const profileHash = hashRuntimeProfile(profile);

  return ServerRuntimeSnapshotSchema.parse({
    schemaVersion: 1,
    kind: 'server',
    capturedAt: input.capturedAt,
    profile,
    profileHash,
    registryHash: hashServerRegistry(profileHash, blocks),
    blocks,
  });
}

export interface CreateClientRuntimeSnapshotInput {
  capturedAt: string;
  profile: RuntimeProfile;
  blocks: ClientBlockSnapshot[];
}

export function createClientRuntimeSnapshot(
  input: CreateClientRuntimeSnapshotInput,
): ClientRuntimeSnapshot {
  const profile = RuntimeProfileSchema.parse(input.profile);
  const blocks = sortedBlocks(
    input.blocks.map((block) => ClientBlockSnapshotSchema.parse(block)),
  );
  const profileHash = hashRuntimeProfile(profile);

  return ClientRuntimeSnapshotSchema.parse({
    schemaVersion: 1,
    kind: 'client',
    capturedAt: input.capturedAt,
    profile,
    profileHash,
    registryHash: hashClientRegistry(profileHash, blocks),
    blocks,
  });
}

export function parseServerRuntimeSnapshot(
  input: unknown,
): ServerRuntimeSnapshot {
  const snapshot = ServerRuntimeSnapshotSchema.parse(input);
  const expectedProfileHash = hashRuntimeProfile(snapshot.profile);
  if (snapshot.profileHash !== expectedProfileHash) {
    throw new Error('Server snapshot profile hash mismatch');
  }

  const expectedRegistryHash = hashServerRegistry(
    snapshot.profileHash,
    snapshot.blocks,
  );
  if (snapshot.registryHash !== expectedRegistryHash) {
    throw new Error('Server snapshot registry hash mismatch');
  }

  return snapshot;
}

export function parseClientRuntimeSnapshot(
  input: unknown,
): ClientRuntimeSnapshot {
  const snapshot = ClientRuntimeSnapshotSchema.parse(input);
  const expectedProfileHash = hashRuntimeProfile(snapshot.profile);
  if (snapshot.profileHash !== expectedProfileHash) {
    throw new Error('Client snapshot profile hash mismatch');
  }

  const expectedRegistryHash = hashClientRegistry(
    snapshot.profileHash,
    snapshot.blocks,
  );
  if (snapshot.registryHash !== expectedRegistryHash) {
    throw new Error('Client snapshot registry hash mismatch');
  }

  return snapshot;
}
