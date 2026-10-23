/** Terminal output and prompts. Colour follows NO_COLOR / FORCE_COLOR via styleText. */

import { createInterface } from 'node:readline/promises';
import { styleText } from 'node:util';
import type { Problem } from './core/validate.ts';

type Style = Parameters<typeof styleText>[0];
const paint = (style: Style) => (text: string) => styleText(style, text, { stream: process.stdout });

export const bold = paint('bold');
export const dim = paint('dim');
export const red = paint('red');
export const green = paint('green');
export const yellow = paint('yellow');
export const cyan = paint('cyan');

export const say = (text = '') => process.stdout.write(text + '\n');
export const warn = (text: string) => process.stderr.write(styleText('yellow', text, { stream: process.stderr }) + '\n');

export function printProblems(problems: Problem[]) {
  for (const p of problems) {
    const where = p.file ? `${p.file}${p.line ? `:${p.line}${p.col ? `:${p.col}` : ''}` : ''}` : '';
    const label = p.level === 'error' ? red('error') : yellow('warning');
    say(`${label} ${where ? cyan(where) + ' ' : ''}${p.message}`);
  }
}

/** Ask yes/no. Without a terminal there is nobody to ask: the answer is no. */
export async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} ${dim('(y/N)')} `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/** Read a secret without echoing it; piped input is read whole. */
export async function askSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    let data = '';
    for await (const chunk of process.stdin) data += chunk;
    return data.trim();
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const output = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  process.stdout.write(question);
  output._writeToOutput = () => {};
  try {
    return (await rl.question('')).trim();
  } finally {
    rl.close();
    process.stdout.write('\n');
  }
}
