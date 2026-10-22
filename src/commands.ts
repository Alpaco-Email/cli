/**
 * commands.ts: what each `alpaco` command does. Wiring and options are in cli.ts.
 */

import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { removedKeys, type RemovedKey } from './core/changes.ts';
import { AlpacoClient, ApiError, DEFAULT_HOST, normaliseHost, type PendingChange } from './core/client.ts';
import { defaultHost, removeToken, resolveAuth, saveToken, NotLoggedIn } from './core/config.ts';
import { sameJson } from './core/order.ts';
import { Project, ProjectError, hashDesign } from './core/project.ts';
import { validateDesign, type Problem } from './core/validate.ts';
import { askSecret, bold, confirm, cyan, dim, green, printProblems, red, say, warn, yellow } from './ui.ts';

interface Global {
  host?: string;
}

function makeClient(auth: { host: string; token: string }) {
  return new AlpacoClient({
    ...auth,
    onRateLimit: (s) => warn(`Rate limited by Alpaco; waiting ${s}s…`),
  });
}

async function clientFor(opts: Global, projectHost?: string) {
  return makeClient(await resolveAuth({ host: opts.host, projectHost }));
}

async function openProject(dir: string, opts: Global) {
  const project = await Project.load(dir);
  const client = await clientFor(opts, project.info.host);
  return { project, client };
}

const when = (iso: string | null | undefined) => (iso ? iso.slice(0, 16).replace('T', ' ') : '');
const out = (value: unknown) => say(JSON.stringify(value, null, 2));

// ── auth ────────────────────────────────────────────────────────────────

export async function login(opts: Global & { token?: string }) {
  const host = normaliseHost(opts.host || (await defaultHost()));
  let token = opts.token;
  if (!token) {
    if (process.stdin.isTTY) {
      say(`Generate a token in Alpaco: your profile page → ${bold('Personal access token')} → ${bold('Generate Token')}`);
      say(dim(`${host}`));
    }
    token = await askSecret('Paste the token: ');
  }
  if (!token) throw new ProjectError('No token given.');

  const me = await makeClient({ host, token }).me();
  const file = await saveToken(host, token, me.user.email);
  say(green(`Logged in to ${host} as ${me.user.name} (${me.user.email}).`));
  printOrganizations(me.organizations);
  say(dim(`Token saved to ${file}`));
}

export async function logout(opts: Global & { all?: boolean }) {
  const host = opts.all ? undefined : normaliseHost(opts.host || (await defaultHost()));
  const removed = await removeToken(host);
  say(removed ? `Logged out${host ? ` of ${host}` : ''}.` : 'You were not logged in.');
  if (process.env.ALPACO_TOKEN) warn('ALPACO_TOKEN is still set in this shell and will keep being used.');
}

export async function whoami(opts: Global & { json?: boolean }) {
  const client = await clientFor(opts);
  const me = await client.me();
  if (opts.json) return out({ host: client.host, ...me });
  say(`${bold(me.user.name)} (${me.user.email}) on ${client.host}`);
  if (process.env.ALPACO_TOKEN) say(dim('Using the token in ALPACO_TOKEN.'));
  printOrganizations(me.organizations);
}

function printOrganizations(orgs: { name: string; role: string }[]) {
  for (const org of orgs) say(`  ${org.name} ${dim(org.role)}`);
}

// ── templates ───────────────────────────────────────────────────────────

export async function list(opts: Global & { org?: string; json?: boolean }) {
  const client = await clientFor(opts);
  const templates = await client.templates(opts.org);
  if (opts.json) return out(templates);
  if (!templates.length) return say('No templates you can open.');

  const byOrg = Map.groupBy(templates, (t) => t.organization.name);
  for (const [org, items] of [...byOrg].sort(([a], [b]) => a.localeCompare(b))) {
    say(bold(org));
    for (const t of items.sort((a, b) => a.name.localeCompare(b.name))) {
      say(`  ${String(t.id).padStart(5)}  ${t.name}  ${dim(`v${t.version} · ${when(t.updated_at)}`)}`);
    }
  }
}

export async function pull(idArg: string, dirArg: string | undefined, opts: Global & { force?: boolean }) {
  const id = templateId(idArg);
  let project: Project | undefined;
  let dir = dirArg;

  if (dir && Project.exists(dir)) {
    project = await Project.load(dir);
    if (project.info.template !== id) {
      throw new ProjectError(`${dir} holds template ${project.info.template}, not ${id}.`);
    }
  }

  const client = await clientFor(opts, project?.info.host);
  const template = await client.template(id);
  dir ??= slug(template.name) || `template-${id}`;

  if (!project && Project.exists(dir)) project = await Project.load(dir);
  if (project) {
    if (project.info.template !== id) throw new ProjectError(`${dir} holds template ${project.info.template}, not ${id}.`);
    if (!opts.force) {
      const base = await project.base(client);
      const { design } = await project.readDesign(base);
      if (!sameJson(design, base)) {
        throw new ProjectError(`${dir} has changes that haven't been pushed. Push them, or pull with --force to overwrite them.`);
      }
    }
  } else if (existsSync(dir) && readdirSync(dir).length > 0) {
    throw new ProjectError(`${dir} already exists and is not empty. Choose another folder: alpaco pull ${id} <folder>`);
  }

  project ??= new Project(resolve(dir), { template: id, name: template.name, version: template.version });
  const host = client.host === DEFAULT_HOST ? undefined : client.host;
  await project.writePulled(template.design, { template: id, name: template.name, version: template.version, ...(host && { host }) });

  // The files must give back exactly what was pulled, or a push would change things nobody edited.
  const { design } = await project.readDesign(template.design);
  if (!sameJson(design, template.design)) {
    warn('The files do not reproduce the pulled design exactly. Please report this: https://github.com/Alpaco-Email/cli/issues');
  }

  say(green(`Pulled "${template.name}" (version ${template.version}) into ${dir}`));
  say(dim(`  ${template.design.blocks?.length ?? 0} blocks · edit the files, then: alpaco validate, alpaco diff, alpaco push`));
  if (!template.permissions.write) warn('You can read this template but not edit it, so you will not be able to push.');
  if (template.pending.length) say(yellow(`  ${template.pending.length} pending change(s) waiting for review. See: alpaco status`));
}

export async function validate(dir: string, opts: Global & { json?: boolean }) {
  const project = await Project.load(dir);
  let base = await project.base();
  if (!base) {
    try {
      base = await project.base(await clientFor(opts, project.info.host));
    } catch (err) {
      if (!(err instanceof NotLoggedIn)) throw err;
    }
  }
  const { design, layout } = await project.readDesign(base);
  const problems = [...validateDesign(design, layout), ...(base ? removedKeyWarnings(removedKeys(base, design)) : [])];

  if (opts.json) out({ ok: !problems.some((p) => p.level === 'error'), problems });
  else {
    printProblems(problems);
    if (!base) say(dim('Not checked for removed keys: log in, or pull again, to compare with the pulled version.'));
    const errors = problems.filter((p) => p.level === 'error').length;
    say(errors ? red(`${errors} error(s): fix them before pushing.`) : green('Valid.'));
  }
  if (problems.some((p) => p.level === 'error')) process.exitCode = 1;
}

export async function diff(dir: string, opts: Global & { json?: boolean }) {
  const { project, client } = await openProject(dir, opts);
  const base = await project.base(client);
  const { design } = await project.readDesign(base);
  const result = await client.diff(project.info.template, design);
  if (opts.json) return out(result);
  say(result.markdown.trimEnd());
  if (result.live_version !== project.info.version) {
    warn(`\nThese files were pulled at version ${project.info.version}; live is version ${result.live_version}, so the diff includes changes made in Alpaco since. Pull before pushing.`);
  }
}

export async function push(dir: string, opts: Global & { yes?: boolean }) {
  const { project, client } = await openProject(dir, opts);
  const base = await project.base(client);
  const { design, layout } = await project.readDesign(base);

  const problems = validateDesign(design, layout);
  if (problems.length) {
    printProblems(problems);
    throw new ProjectError('Not pushed: fix the errors above first (alpaco validate).');
  }
  if (sameJson(design, base)) {
    say(`Nothing to push: the files match version ${project.info.version}.`);
    return;
  }

  const removed = removedKeys(base, design);
  if (removed.length) {
    printProblems(removedKeyWarnings(removed));
    if (!opts.yes) {
      if (!process.stdin.isTTY) throw new ProjectError('Not pushed: keys were removed or renamed. Re-run with --yes to push anyway.');
      if (!(await confirm('Push anyway?'))) throw new ProjectError('Not pushed.');
    }
  }

  const { template: id, version } = project.info;
  try {
    const result = await client.pushDesign(id, design, version);
    await project.track({
      id: result.pending_id, kind: 'design', base_version: result.base_version,
      created_at: new Date().toISOString(), review_url: result.review_url, design_hash: '',
    }, design);
    say(green(`Pending review (#${result.pending_id}). Nothing is live until someone publishes it in Alpaco.`));
    say(`  Review: ${cyan(result.review_url)}`);
    say(dim('  Check on it with: alpaco status'));
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      const now = err.body.current_version;
      throw new ProjectError(
        `Not pushed: the template was saved in Alpaco after you pulled version ${version}${now ? ` (it is now version ${now})` : ''}.\n` +
        'Keep a copy of your changes, run `alpaco pull --force`, re-apply them and push again.',
      );
    }
    if (err instanceof ApiError && err.status === 403) {
      throw new ProjectError('Not pushed: you can read this template but not edit it.');
    }
    throw err;
  }
}

export async function status(dir: string, opts: Global & { json?: boolean }) {
  const { project, client } = await openProject(dir, opts);
  const { template: id } = project.info;
  const template = await client.template(id);
  const base = await project.base(client);
  const { design } = await project.readDesign(base);
  const edited = !sameJson(design, base);

  // Changes pushed from here that are no longer open: published, rejected or withdrawn.
  const tracked = await project.tracked();
  const open = new Set(template.pending.map((p) => p.id));
  const closed: PendingChange[] = [];
  for (const t of tracked.filter((t) => !open.has(t.id))) {
    try {
      closed.push(await client.pending(id, t.id));
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) throw err;
    }
  }
  const details = new Map<number, PendingChange>();
  for (const p of template.pending.filter((p) => p.status === 'outdated')) details.set(p.id, await client.pending(id, p.id));

  // Our own change was published and nothing else happened since: move the files' version on.
  let caughtUp: number | undefined;
  for (const change of closed) {
    const mine = tracked.find((t) => t.id === change.id);
    if (change.status === 'published' && change.published_version === template.version && mine &&
        mine.base_version === project.info.version && mine.design_hash === hashDesign(design)) {
      const published = await client.version(id, template.version);
      project.info.version = template.version;
      await project.saveInfo();
      await project.saveBase(published.design, template.version);
      caughtUp = template.version;
    }
  }
  await project.untrack(tracked.filter((t) => !open.has(t.id)).map((t) => t.id));

  if (opts.json) {
    return out({
      template: { id, name: template.name, live_version: template.version },
      files: { version: project.info.version, edited, caught_up_to: caughtUp ?? null },
      pending: template.pending.map((p) => ({ ...p, ...details.get(p.id), mine: tracked.some((t) => t.id === p.id) })),
      closed,
    });
  }

  say(`${bold(template.name)} ${dim(`#${id}`)}: live version ${template.version}`);
  if (caughtUp) say(green(`Your change was published: your files are now at version ${caughtUp}.`));
  const behind = template.version !== project.info.version;
  say(`Your files: version ${project.info.version}${edited ? yellow(', edited') : ''}${behind ? red(' (out of date: pull before pushing)') : ''}`);
  if (template.editing_lock && !template.editing_lock.is_mine) {
    say(dim(`Open in Alpaco by ${template.editing_lock.user?.full_name ?? 'someone'}: publishing waits until they close it.`));
  }

  say();
  if (!template.pending.length) say(dim('No pending changes.'));
  for (const p of template.pending) {
    const mine = tracked.some((t) => t.id === p.id) ? cyan(' (yours)') : '';
    say(`${statusLabel(p.status)} #${p.id} ${p.kind} by ${p.user?.name ?? 'unknown'} ${dim(when(p.created_at))}${mine}`);
    const reason = details.get(p.id)?.outdated_reason;
    if (reason) say(`    ${reason}. Pull, re-apply and push again.`);
    say(`    ${dim(p.review_url)}`);
  }
  for (const c of closed) {
    say(`${statusLabel(c.status)} #${c.id} ${c.kind}${c.published_version ? ` as version ${c.published_version}` : ''}` +
      `${c.reviewed_by ? ` by ${c.reviewed_by.name}` : ''} ${dim(when(c.reviewed_at))}`);
    if (c.review_note) say(`    "${c.review_note}"`);
  }
}

export async function withdraw(pendingArg: string, dir: string, opts: Global) {
  const pendingId = Number(pendingArg);
  if (!Number.isInteger(pendingId)) throw new ProjectError(`"${pendingArg}" is not a pending change id.`);
  const { project, client } = await openProject(dir, opts);
  try {
    await client.withdraw(project.info.template, pendingId);
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) throw new ProjectError('Only the person who pushed a change can withdraw it.');
    throw err;
  }
  await project.untrack([pendingId]);
  say(green(`Withdrew pending change #${pendingId}.`));
}

// ── helpers ─────────────────────────────────────────────────────────────

function removedKeyWarnings(removed: RemovedKey[]): Problem[] {
  return removed.map((r) => ({
    level: 'warning',
    message: `${r.kind} key "${r.path}" was removed or renamed: emails lose the content stored under it when a marketer clicks Update layout.`,
  }));
}

function statusLabel(s: string) {
  const colour = { pending: yellow, outdated: red, rejected: red, published: green, withdrawn: dim }[s] ?? ((t: string) => t);
  return colour(s.padEnd(9));
}

function templateId(arg: string): number {
  const id = Number(arg);
  if (!Number.isInteger(id) || id <= 0) throw new ProjectError(`"${arg}" is not a template id. Find ids with: alpaco list`);
  return id;
}

function slug(name: string) {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
