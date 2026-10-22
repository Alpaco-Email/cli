/**
 * files.ts: a design as files a developer edits, and back.
 *
 *   template.json             the design without its base, blocks' code and global variables;
 *                             "blocks" lists the block folders in email order
 *   base/config.json          the base: input groups and settings
 *   base/code.liquid          the base's Liquid
 *   blocks/<folder>/…         the same for each block
 *   vars/global.json          vars.global, the global variables (JSON, kept as text)
 *
 * Text files get a final newline when written and lose exactly one when read,
 * so `code` that never had one round-trips unchanged and editors that add
 * one change nothing.
 */

import { orderLike } from './order.ts';
import type { Design, Json, JsonObject, Unit } from './types.ts';

export const TEMPLATE_FILE = 'template.json';
export const GLOBAL_VARS_FILE = 'vars/global.json';

/** Where each part of the design lives, so problems can name a file. */
export interface Layout {
  base: string;
  /** Block folder per block, in email order. */
  blocks: string[];
}

export type FileMap = Map<string, string>;

const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const text = (value: string) => value + '\n';
const untext = (value: string) => (value.endsWith('\n') ? value.slice(0, -1) : value);

/** A folder name for each block: its key, made safe for a path and unique. */
export function blockFolders(blocks: Unit[]): string[] {
  const used = new Set<string>();
  return blocks.map((block) => {
    const base = String(block.key ?? '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'block';
    let folder = base;
    for (let n = 2; used.has(folder.toLowerCase()); n++) folder = `${base}-${n}`;
    used.add(folder.toLowerCase());
    return folder;
  });
}

export function designToFiles(design: Design): FileMap {
  const files: FileMap = new Map();
  const blocks = design.blocks ?? [];
  const folders = blockFolders(blocks);

  const root: JsonObject = {};
  for (const [key, value] of Object.entries(design)) {
    if (key === 'base') continue;
    if (key === 'blocks') root.blocks = folders;
    else if (key === 'vars' && isObject(value) && typeof value.global === 'string') {
      const { global, ...rest } = value;
      files.set(GLOBAL_VARS_FILE, text(global as string));
      root.vars = rest;
    } else root[key] = value as Json;
  }
  files.set(TEMPLATE_FILE, json(root));

  if (design.base) writeUnit(files, 'base', design.base);
  blocks.forEach((block, i) => writeUnit(files, `blocks/${folders[i]}`, block));
  return files;
}

function writeUnit(files: FileMap, dir: string, unit: Unit) {
  const { code, ...config } = unit;
  files.set(`${dir}/config.json`, json(config));
  if (typeof code === 'string') files.set(`${dir}/code.liquid`, text(code));
}

export class LayoutError extends Error {}

/**
 * Join the files back into a design. `reference` is the design as it was
 * pulled; its key order is restored so an unedited pull pushes back exactly.
 */
export function filesToDesign(read: (path: string) => string | undefined, reference?: Design): { design: Design; layout: Layout } {
  const rootText = read(TEMPLATE_FILE);
  if (rootText === undefined) throw new LayoutError(`${TEMPLATE_FILE} is missing. Is this a folder made by \`alpaco pull\`?`);
  const root = parseJson(rootText, TEMPLATE_FILE);
  if (!isObject(root)) throw new LayoutError(`${TEMPLATE_FILE} must hold a JSON object.`);

  const folders = root.blocks ?? [];
  if (!Array.isArray(folders) || folders.some((f) => typeof f !== 'string')) {
    throw new LayoutError(`"blocks" in ${TEMPLATE_FILE} must list the block folders, e.g. ["header", "hero"].`);
  }

  const design: Design = {};
  for (const [key, value] of Object.entries(root)) {
    design[key] = key === 'blocks'
      ? (folders as string[]).map((folder) => readUnit(read, `blocks/${folder}`)) as Json
      : value;
  }
  if (read('base/config.json') !== undefined) design.base = readUnit(read, 'base');

  const globalVars = read(GLOBAL_VARS_FILE);
  if (globalVars !== undefined) {
    design.vars = { ...(isObject(design.vars) ? design.vars : {}), global: untext(globalVars) };
  }

  return {
    design: reference ? orderLike(design, reference) : design,
    layout: { base: 'base', blocks: (folders as string[]).map((f) => `blocks/${f}`) },
  };
}

function readUnit(read: (path: string) => string | undefined, dir: string): Unit {
  const configText = read(`${dir}/config.json`);
  if (configText === undefined) throw new LayoutError(`${dir}/config.json is missing.`);
  const config = parseJson(configText, `${dir}/config.json`);
  if (!isObject(config)) throw new LayoutError(`${dir}/config.json must hold a JSON object.`);
  const unit: Unit = { ...config };
  const code = read(`${dir}/code.liquid`);
  if (code !== undefined) unit.code = untext(code);
  return unit;
}

function parseJson(source: string, file: string): unknown {
  try {
    return JSON.parse(source);
  } catch (err) {
    throw new LayoutError(`${file} is not valid JSON: ${(err as Error).message}`);
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
