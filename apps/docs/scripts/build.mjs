import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(root, '../..');
const desktopRoot = resolve(repoRoot, 'apps/desktop');

await run('pnpm', ['exec', 'astro', 'build'], root);
await run('pnpm', ['--dir', desktopRoot, 'build:web-demo'], repoRoot);

function run(command, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
      shell: false,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? 'unknown'}`));
    });
  });
}
