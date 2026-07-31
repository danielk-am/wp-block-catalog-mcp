import { z } from 'zod';

import {
  ClientBlockSnapshotSchema,
  JsonObjectSchema,
  JsonValueSchema,
  RuntimeProfileSchema,
  ServerBlockSnapshotSchema,
  createClientRuntimeSnapshot,
  createServerRuntimeSnapshot,
} from './runtime/index.js';
import type {
  ClientBlockSnapshot,
  JsonValue,
  RuntimeDeprecation,
  RuntimeTransform,
  RuntimeVariation,
  ServerBlockSnapshot,
} from './runtime/index.js';

const RawProbeSchema = z.object({
  capturedAt: z.string().datetime({ offset: true }),
  profile: RuntimeProfileSchema,
  blocks: z.array(z.record(z.string(), z.unknown())),
}).passthrough();

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function jsonObject(value: unknown): Record<string, JsonValue> {
  return JsonObjectSchema.parse(record(value));
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function nullablePositiveInteger(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0
    ? value
    : null;
}

function variations(value: unknown): RuntimeVariation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(record)
    .filter(({ name }) => typeof name === 'string' && name.length > 0)
    .map((variation) => ({
      name: variation.name as string,
      title: typeof variation.title === 'string' ? variation.title : null,
      scope: strings(variation.scope),
      isDefault: variation.isDefault === true,
      attributes: jsonObject(variation.attributes),
      innerBlocks: Array.isArray(variation.innerBlocks)
        ? variation.innerBlocks.map((item) => JsonValueSchema.parse(item))
        : [],
    }));
}

function blockHooks(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record(value))
      .filter((entry): entry is [string, string] =>
        typeof entry[1] === 'string'),
  );
}

function transforms(value: unknown): RuntimeTransform[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(record).map((transform) => {
    const callbacks = record(transform.callbacks);
    return {
      type: typeof transform.type === 'string'
        ? transform.type
        : 'block',
      blockNames: strings(
        transform.blockNames ?? transform.blocks ??
        (typeof transform.blockName === 'string'
          ? [ transform.blockName ]
          : []),
      ),
      priority: typeof transform.priority === 'number' &&
        Number.isFinite(transform.priority)
        ? transform.priority
        : null,
      isMultiBlock: typeof transform.isMultiBlock === 'boolean'
        ? transform.isMultiBlock
        : null,
      callbacks: {
        transform:
          callbacks.transform === true ||
          transform.transformPresent === true,
        isMatch:
          callbacks.isMatch === true ||
          transform.isMatchPresent === true,
      },
    };
  });
}

function deprecations(value: unknown): RuntimeDeprecation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(record).map((deprecation, index) => {
    const callbacks = record(deprecation.callbacks);
    return {
      index: typeof deprecation.index === 'number' &&
        Number.isInteger(deprecation.index) &&
        deprecation.index >= 0
        ? deprecation.index
        : index,
      attributes: jsonObject(deprecation.attributes),
      supports: jsonObject(deprecation.supports),
      callbacks: {
        save: callbacks.save === true,
        migrate: callbacks.migrate === true,
        isEligible: callbacks.isEligible === true,
      },
    };
  });
}

function registryFields(raw: Record<string, unknown>) {
  return {
    name: raw.name,
    apiVersion: nullablePositiveInteger(
      raw.apiVersion ?? raw.api_version,
    ),
    attributes: jsonObject(raw.attributes),
    supports: jsonObject(raw.supports),
    parent: strings(raw.parent),
    ancestor: strings(raw.ancestor),
    allowedBlocks: strings(raw.allowedBlocks ?? raw.allowed_blocks),
    providesContext: jsonObject(
      raw.providesContext ?? raw.provides_context,
    ),
    usesContext: strings(raw.usesContext ?? raw.uses_context),
    variations: variations(raw.variations),
    blockHooks: blockHooks(raw.blockHooks ?? raw.block_hooks),
  };
}

function serverBlock(raw: Record<string, unknown>): ServerBlockSnapshot {
  const callbacks = record(raw.callbacks);
  const renderCallback =
    typeof callbacks.render === 'boolean'
      ? callbacks.render
      : typeof raw.renderCallbackPresent === 'boolean'
        ? raw.renderCallbackPresent
        : null;
  return ServerBlockSnapshotSchema.parse({
    ...registryFields(raw),
    isDynamic:
      raw.isDynamic === true ||
      raw.is_dynamic === true ||
      raw.dynamic === true,
    callbacks: {
      render: renderCallback,
    },
  });
}

function clientBlock(raw: Record<string, unknown>): ClientBlockSnapshot {
  const callbacks = record(raw.callbacks);
  const rawTransforms = record(raw.transforms);
  return ClientBlockSnapshotSchema.parse({
    ...registryFields(raw),
    inserterVisible: typeof raw.inserterVisible === 'boolean'
      ? raw.inserterVisible
      : null,
    transforms: {
      from: transforms(rawTransforms.from),
      to: transforms(rawTransforms.to),
    },
    deprecations: deprecations(raw.deprecations),
    callbacks: {
      edit: callbacks.edit === true || raw.editCallbackPresent === true,
      save: callbacks.save === true || raw.saveHandlerPresent === true,
    },
  });
}

export function importServerProbe(input: unknown) {
  const raw = RawProbeSchema.parse(input);
  return createServerRuntimeSnapshot({
    capturedAt: raw.capturedAt,
    profile: raw.profile,
    blocks: raw.blocks.map(serverBlock),
  });
}

export function importClientProbe(input: unknown) {
  const raw = RawProbeSchema.parse(input);
  return createClientRuntimeSnapshot({
    capturedAt: raw.capturedAt,
    profile: raw.profile,
    blocks: raw.blocks.map(clientBlock),
  });
}
