import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'src');
const output = resolve(root, '.build/site');

await rm(output, { force: true, recursive: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });

console.log(`Built docs site: ${output}`);
