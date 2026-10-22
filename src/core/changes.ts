/**
 * changes.ts: keys that disappeared since the pull.
 *
 * Emails store marketers' content against block, input group and input
 * keys. When a key is renamed or removed, that content is lost the next time
 * a marketer clicks "Update layout" in an email built from the template. A
 * rename looks like a removal plus an addition, so removals are what get
 * reported.
 */

import type { Design, Unit } from './types.ts';

export interface RemovedKey {
  kind: 'block' | 'group' | 'input';
  /** e.g. `hero`, `hero › content`, `hero › content › headline` (`base` for the base). */
  path: string;
}

export function removedKeys(before: Design, after: Design): RemovedKey[] {
  const removed: RemovedKey[] = [];
  const afterBlocks = new Map((after.blocks ?? []).filter((b) => b.key).map((b) => [b.key!, b]));

  const compareUnits = (name: string, was: Unit, now: Unit) => {
    const nowGroups = new Map((now.inputGroups ?? []).filter((g) => g.key).map((g) => [g.key!, g]));
    for (const group of was.inputGroups ?? []) {
      if (!group.key) continue;
      const nowGroup = nowGroups.get(group.key);
      if (!nowGroup) {
        removed.push({ kind: 'group', path: `${name} › ${group.key}` });
        continue;
      }
      const nowInputs = new Set((nowGroup.inputs ?? []).map((i) => i.key));
      for (const input of group.inputs ?? []) {
        if (typeof input.key === 'string' && input.key && !nowInputs.has(input.key)) {
          removed.push({ kind: 'input', path: `${name} › ${group.key} › ${input.key}` });
        }
      }
    }
  };

  if (before.base && after.base) compareUnits('base', before.base, after.base);
  for (const block of before.blocks ?? []) {
    if (!block.key) continue;
    const now = afterBlocks.get(block.key);
    if (!now) removed.push({ kind: 'block', path: block.key });
    else compareUnits(block.key, block, now);
  }
  return removed;
}
