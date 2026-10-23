/**
 * How to run another command, the way the user is running this one: through
 * npx the `alpaco` command isn't installed, so suggesting it would fail.
 */
export function run(args: string): string {
  const viaNpx = process.env.npm_command === 'exec';
  return `${viaNpx ? 'npx @alpaco-email/cli' : 'alpaco'} ${args}`;
}
