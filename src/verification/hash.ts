import { createHash } from 'node:crypto';

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

function canonicalize(value: unknown, seen: Set<object>): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Cannot hash a non-finite number');
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new TypeError('Cannot hash a cyclic array');
    }
    seen.add(value);
    const serialized = `[${value
      .map((item) => canonicalize(item, seen))
      .join(',')}]`;
    seen.delete(value);
    return serialized;
  }

  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Cannot hash a non-plain object');
    }
    if (seen.has(value)) {
      throw new TypeError('Cannot hash a cyclic object');
    }
    seen.add(value);

    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([ left ], [ right ]) => {
        if (left < right) {
          return -1;
        }
        if (left > right) {
          return 1;
        }
        return 0;
      })
      .map(([ key, item ]) => {
        if (item === undefined) {
          throw new TypeError(`Cannot hash undefined property "${key}"`);
        }
        return `${JSON.stringify(key)}:${canonicalize(item, seen)}`;
      });

    seen.delete(value);
    return `{${entries.join(',')}}`;
  }

  throw new TypeError(`Cannot hash value of type ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value, new Set());
}

export function hashCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
