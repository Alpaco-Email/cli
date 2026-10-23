/**
 * project.ts: a pulled template on disk.
 *
 *   alpaco.json        which template this is and the version it was pulled at
 *                      (commit it: CI needs the version to push)
 *   …design files…     see files.ts
 *   .alpaco/           this machine's working state, ignored by git:
 *     base.json        the design exactly as pulled, for key order and for
 *                      warning about removed keys (fetched again if missing)
 *     pending.json     pending changes pushed from here, for `alpaco status`
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DEFAULT_HOST, normaliseHost, type AlpacoClient, type PendingSummary } from './client.ts';
import { run } from './hint.ts';
import { GLOBAL_VARS_FILE, TEMPLATE_FILE, designToFiles, filesToDesign, type Layout } from './files.ts';
import type { Design } from './types.ts';

export const PROJECT_FILE = 'alpaco.json';
const STATE_DIR = '.alpaco';

export interface ProjectInfo {
  template: number;
  name: string;
  /** The live version the files were pulled at: sent as base_version on push. */
  version: number;
  /** Only set when it is not platform.alpaco.email. */
  host?: string;
}

export interface TrackedPending {
  id: number;
  kind: string;
  base_version: number;
  created_at: string;
  review_url: string;
  /** Hash of the design pushed, to tell whether the files changed since. */
  design_hash: string;
}

export class ProjectError extends Error {}

export class Project {
  constructor(readonly dir: string, public info: ProjectInfo) {}

  static async load(dir = '.'): Promise<Project> {
    const root = resolve(dir);
    const file = join(root, PROJECT_FILE);
    if (!existsSync(file)) {
      throw new ProjectError(`No ${PROJECT_FILE} in ${root}. Run \`${run('pull <template id>')}\` first, or pass the folder.`);
    }
    let info: ProjectInfo;
    try {
      info = JSON.parse(await readFile(file, 'utf8'));
    } catch (err) {
      throw new ProjectError(`${PROJECT_FILE} is not valid JSON: ${(err as Error).message}`);
    }
    if (!Number.isInteger(info.template) || !Number.isInteger(info.version)) {
      throw new ProjectError(`${PROJECT_FILE} needs a numeric "template" and "version".`);
    }
    return new Project(root, info);
  }

  static exists(dir: string) {
    return existsSync(join(resolve(dir), PROJECT_FILE));
  }

  get host() {
    return normaliseHost(this.info.host ?? DEFAULT_HOST);
  }

  /** Read the design from the files, keys ordered like the pulled design. */
  async readDesign(reference?: Design): Promise<{ design: Design; layout: Layout }> {
    const files = new Map<string, string>();
    const read = (path: string) => files.get(path);
    // filesToDesign reads synchronously; load what it may ask for first.
    for (const path of await this.designPaths()) {
      files.set(path, await readFile(join(this.dir, path), 'utf8'));
    }
    return filesToDesign(read, reference);
  }

  /** Replace the design files with `design`, and record it as the pulled version. */
  async writePulled(design: Design, info: ProjectInfo) {
    for (const managed of ['base', 'blocks', GLOBAL_VARS_FILE, TEMPLATE_FILE]) {
      await rm(join(this.dir, managed), { recursive: true, force: true });
    }
    for (const [path, content] of designToFiles(design)) {
      await mkdir(dirname(join(this.dir, path)), { recursive: true });
      await writeFile(join(this.dir, path), content);
    }
    this.info = info;
    await writeFile(join(this.dir, PROJECT_FILE), JSON.stringify(info, null, 2) + '\n');
    await this.saveBase(design, info.version);
  }

  async saveInfo() {
    await writeFile(join(this.dir, PROJECT_FILE), JSON.stringify(this.info, null, 2) + '\n');
  }

  /**
   * The design as pulled at `info.version`, from .alpaco/ or else from the
   * API. Without a client and nothing cached, there is none.
   */
  async base(client: AlpacoClient): Promise<Design>;
  async base(client?: AlpacoClient): Promise<Design | undefined>;
  async base(client?: AlpacoClient): Promise<Design | undefined> {
    try {
      const cached = JSON.parse(await readFile(this.statePath('base.json'), 'utf8'));
      if (cached.template === this.info.template && cached.version === this.info.version) return cached.design;
    } catch {
      // Not cached on this machine (a fresh clone, or CI): fetch it.
    }
    if (!client) return undefined;
    const { design } = await client.version(this.info.template, this.info.version);
    await this.saveBase(design, this.info.version);
    return design;
  }

  async saveBase(design: Design, version: number) {
    await this.ensureStateDir();
    await writeFile(this.statePath('base.json'), JSON.stringify({ template: this.info.template, version, design }) + '\n');
  }

  async tracked(): Promise<TrackedPending[]> {
    try {
      return JSON.parse(await readFile(this.statePath('pending.json'), 'utf8'));
    } catch {
      return [];
    }
  }

  async track(change: PendingSummary | TrackedPending, design: Design) {
    const list = (await this.tracked()).filter((p) => p.id !== change.id);
    list.push({
      id: change.id,
      kind: change.kind,
      base_version: change.base_version,
      created_at: change.created_at,
      review_url: change.review_url,
      design_hash: hashDesign(design),
    });
    await this.saveTracked(list);
  }

  async untrack(ids: number[]) {
    await this.saveTracked((await this.tracked()).filter((p) => !ids.includes(p.id)));
  }

  private async saveTracked(list: TrackedPending[]) {
    await this.ensureStateDir();
    await writeFile(this.statePath('pending.json'), JSON.stringify(list, null, 2) + '\n');
  }

  private statePath(name: string) {
    return join(this.dir, STATE_DIR, name);
  }

  private async ensureStateDir() {
    await mkdir(join(this.dir, STATE_DIR), { recursive: true });
    // Keeps the working state out of git without touching the user's .gitignore.
    const ignore = join(this.dir, STATE_DIR, '.gitignore');
    if (!existsSync(ignore)) await writeFile(ignore, '*\n');
  }

  private async designPaths(): Promise<string[]> {
    const paths = [TEMPLATE_FILE, GLOBAL_VARS_FILE, 'base/config.json', 'base/code.liquid'];
    const blocksDir = join(this.dir, 'blocks');
    if (existsSync(blocksDir)) {
      for (const entry of await readdir(blocksDir, { withFileTypes: true })) {
        if (entry.isDirectory()) paths.push(`blocks/${entry.name}/config.json`, `blocks/${entry.name}/code.liquid`);
      }
    }
    return paths.filter((p) => existsSync(join(this.dir, p)));
  }
}

export function hashDesign(design: Design): string {
  return createHash('sha256').update(JSON.stringify(design)).digest('hex');
}
