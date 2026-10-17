import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'out');
const destination = resolve(root, 'src-tauri', 'frontend-dist');

const sourceStat = await stat(source).catch(() => null);
if (!sourceStat?.isDirectory()) {
  throw new Error(`Next static export is missing: ${source}`);
}

// Replace the generated directory so removed hashed assets cannot survive
// into a later installer and mask a broken build.
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
