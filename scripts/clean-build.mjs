import { rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(projectRoot, 'dist');
if (basename(outputDir) !== 'dist' || dirname(outputDir) !== projectRoot) {
  throw new Error(`Refusing to clean an unexpected build directory: ${outputDir}`);
}
await rm(outputDir, { recursive: true, force: true });
