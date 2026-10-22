#!/usr/bin/env node
/**
 * alpaco: pull an Alpaco template into files, edit it in any editor, and
 * push it back for review. Pushing never changes the live template; someone
 * publishes the change in Alpaco.
 */

import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import * as commands from './commands.ts';
import { ApiError } from './core/client.ts';
import { NotLoggedIn } from './core/config.ts';
import { LayoutError } from './core/files.ts';
import { ProjectError } from './core/project.ts';
import { red } from './ui.ts';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const program = new Command('alpaco')
  .description('Pull, validate and push Alpaco template designs.')
  .version(version)
  .option('--host <url>', 'Alpaco address (default: platform.alpaco.email, or ALPACO_HOST)')
  .showHelpAfterError();

const run = <A extends unknown[]>(fn: (...args: A) => Promise<unknown>) =>
  async (...args: A) => {
    try {
      await fn(...args);
    } catch (err) {
      if (err instanceof ApiError || err instanceof NotLoggedIn || err instanceof ProjectError || err instanceof LayoutError) {
        process.stderr.write(red(err.message) + '\n');
        process.exitCode = 1;
        return;
      }
      throw err;
    }
  };

const g = () => program.opts<{ host?: string }>();

program.command('login')
  .description('Save your Alpaco personal access token')
  .option('--token <token>', 'the token (otherwise you are asked for it, or it is read from stdin)')
  .action(run((o) => commands.login({ ...g(), ...o })));

program.command('logout')
  .description('Forget the saved token')
  .option('--all', 'forget the tokens for every Alpaco address')
  .action(run((o) => commands.logout({ ...g(), ...o })));

program.command('whoami')
  .description('Show who you are logged in as, and your organizations')
  .option('--json', 'print JSON')
  .action(run((o) => commands.whoami({ ...g(), ...o })));

program.command('list')
  .alias('ls')
  .description('List the templates you can open')
  .option('--org <id>', 'only this organization')
  .option('--json', 'print JSON')
  .action(run((o) => commands.list({ ...g(), ...o })));

program.command('pull')
  .description('Download a template into a folder (or update a pulled folder)')
  .argument('<id>', 'template id (see alpaco list)')
  .argument('[folder]', 'where to put it (default: named after the template)')
  .option('--force', 'overwrite changes in the folder that have not been pushed')
  .action(run((id, folder, o) => commands.pull(id, folder, { ...g(), ...o })));

program.command('validate')
  .description('Check the design before pushing')
  .argument('[folder]', 'pulled folder', '.')
  .option('--json', 'print JSON')
  .action(run((folder, o) => commands.validate(folder, { ...g(), ...o })));

program.command('diff')
  .description('Show what pushing would change against the live template')
  .argument('[folder]', 'pulled folder', '.')
  .option('--json', 'print JSON')
  .action(run((folder, o) => commands.diff(folder, { ...g(), ...o })));

program.command('push')
  .description('Propose your changes for review in Alpaco')
  .argument('[folder]', 'pulled folder', '.')
  .option('-y, --yes', 'push even if keys were removed or renamed')
  .action(run((folder, o) => commands.push(folder, { ...g(), ...o })));

program.command('status')
  .description('Show the live version and pending changes')
  .argument('[folder]', 'pulled folder', '.')
  .option('--json', 'print JSON')
  .action(run((folder, o) => commands.status(folder, { ...g(), ...o })));

program.command('withdraw')
  .description('Take back a pending change you pushed')
  .argument('<pendingId>', 'the pending change (see alpaco status)')
  .argument('[folder]', 'pulled folder', '.')
  .action(run((pendingId, folder) => commands.withdraw(pendingId, folder, g())));

await program.parseAsync();
