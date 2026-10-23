/**
 * validate.ts: the checks the CLI makes before a push.
 *
 * The API saves any JSON object it is sent, so the template designer's own
 * rules are enforced here. A design that breaks them uploads fine but can
 * never be saved again from the Alpaco designer:
 *
 *   - blocks have non-empty, unique names and keys
 *   - within the base and each block, input groups have non-empty, unique
 *     names and keys, and within each group so do the inputs
 *   - vars.global is valid JSON
 *   - every Liquid template parses (Alpaco renders with liquidjs)
 */

import { Liquid } from 'liquidjs';
import { GLOBAL_VARS_FILE, TEMPLATE_FILE, type Layout } from './files.ts';
import type { Design, Unit } from './types.ts';

export interface Problem {
  level: 'error' | 'warning';
  message: string;
  file?: string;
  line?: number;
  col?: number;
}

const liquid = new Liquid();

export function validateDesign(design: Design, layout?: Layout): Problem[] {
  const problems: Problem[] = [];
  const error = (message: string, file?: string, line?: number, col?: number) =>
    problems.push({ level: 'error', message, file, line, col });

  const blocks = design.blocks ?? [];
  if (!design.base) error('The design has no base.', TEMPLATE_FILE);
  if (!Array.isArray(blocks)) error('"blocks" must be a list.', TEMPLATE_FILE);

  const units: [Unit, string][] = [];
  if (design.base) units.push([design.base, layout?.base ?? 'base']);
  blocks.forEach((block, i) => units.push([block, layout?.blocks[i] ?? `blocks[${i}]`]));

  const blockNames = new Set<string>();
  const blockKeys = new Set<string>();
  blocks.forEach((block, i) => {
    const file = configFile(layout?.blocks[i] ?? `blocks[${i}]`);
    if (!block.key) error('Block has no key.', file);
    else if (blockKeys.has(block.key)) error(`Duplicate block key "${block.key}".`, file);
    if (!block.name) error('Block has no name.', file);
    else if (blockNames.has(block.name)) error(`Duplicate block name "${block.name}".`, file);
    if (block.key) blockKeys.add(block.key);
    if (block.name) blockNames.add(block.name);
  });

  for (const [unit, dir] of units) {
    const file = configFile(dir);
    const groupKeys = new Set<string>();
    const groupNames = new Set<string>();
    for (const group of unit.inputGroups ?? []) {
      // An empty placeholder group shows up in existing templates; flag it without blocking the push.
      if (!group.key && !group.name && !group.inputs?.length) {
        problems.push({ level: 'warning', message: 'Empty input group with no name or key: remove it.', file });
        continue;
      }
      const label = group.name || group.key || '(unnamed)';
      if (!group.key) error(`Input group "${label}" has no key.`, file);
      else if (groupKeys.has(group.key)) error(`Duplicate input group key "${group.key}".`, file);
      if (!group.name) error(`Input group "${label}" has no name.`, file);
      else if (groupNames.has(group.name)) error(`Duplicate input group name "${group.name}".`, file);
      if (group.key) groupKeys.add(group.key);
      if (group.name) groupNames.add(group.name);

      const inputKeys = new Set<string>();
      const inputNames = new Set<string>();
      for (const input of group.inputs ?? []) {
        const key = typeof input.key === 'string' ? input.key : '';
        const name = typeof input.name === 'string' ? input.name : '';
        if (!key) error(`An input in "${label}" has no key.`, file);
        else if (inputKeys.has(key)) error(`Duplicate input key "${key}" in "${label}".`, file);
        if (!name) error(`Input "${key || '(no key)'}" in "${label}" has no name.`, file);
        else if (inputNames.has(name)) error(`Duplicate input name "${name}" in "${label}".`, file);
        if (key) inputKeys.add(key);
        if (name) inputNames.add(name);
      }
    }

    if (typeof unit.code === 'string') {
      try {
        liquid.parse(unit.code);
      } catch (err) {
        const e = err as Error & { token?: { getPosition?: () => [number, number] } };
        const [line, col] = e.token?.getPosition?.() ?? [];
        error(`Liquid: ${e.message.replace(/, line:\d+, col:\d+$/, '')}`, `${dir}/code.liquid`, line, col);
      }
    }
  }

  const global = design.vars?.global;
  if (typeof global === 'string' && global.trim() !== '') {
    try {
      JSON.parse(global);
    } catch (err) {
      const message = (err as Error).message;
      const at = message.match(/\(line (\d+) column (\d+)\)/);
      error(`Global variables are not valid JSON: ${message.replace(/ \(line \d+ column \d+\)$/, '')}`,
        GLOBAL_VARS_FILE, at ? Number(at[1]) : undefined, at ? Number(at[2]) : undefined);
    }
  }

  return problems;
}

const configFile = (dir: string) => (dir.includes('[') ? dir : `${dir}/config.json`);
