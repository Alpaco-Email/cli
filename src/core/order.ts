/**
 * Key order. Alpaco keeps a design exactly as sent, so a pull followed by a
 * push with no edits must send back the same JSON, byte for byte. Splitting
 * a design into files loses where keys sat (code moves to its own file, the
 * base to its own folder), so after joining the files back together the
 * keys are put back in the order of the design as it was pulled.
 */

import type { Json } from './types.ts';

const isObject = (v: unknown): v is { [key: string]: Json } =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Return `value` with its object keys in the order they have in `reference`.
 * Keys the reference doesn't have go after, in their own order. Array items
 * are matched by their `key` field when they have one (blocks, groups,
 * inputs), otherwise by position.
 */
export function orderLike<T>(value: T, reference: unknown): T {
  if (Array.isArray(value)) {
    if (!Array.isArray(reference)) return value;
    const byKey = new Map<string, unknown>();
    for (const item of reference) {
      if (isObject(item) && typeof item.key === 'string') byKey.set(item.key, item);
    }
    return value.map((item, i) => {
      const ref = isObject(item) && typeof item.key === 'string' && byKey.has(item.key)
        ? byKey.get(item.key)
        : reference[i];
      return orderLike(item, ref);
    }) as T;
  }
  if (!isObject(value) || !isObject(reference)) return value;
  const out: { [key: string]: Json } = {};
  for (const key of Object.keys(reference)) {
    if (key in value) out[key] = orderLike(value[key], reference[key]) as Json;
  }
  for (const key of Object.keys(value)) {
    if (!(key in out)) out[key] = value[key] as Json;
  }
  return out as T;
}

/** Deep equality that also compares key order: equal JSON text. */
export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
