import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

await mkdir('dist', { recursive: true });
const html = await readFile('index.html', 'utf8');
const htmlWithImports = html
  .replace('./dist/game.js', './game.js')
  .replaceAll('./dist/vendor/', './vendor/');
await writeFile('dist/index.html', htmlWithImports);
await cp('style.css', 'dist/style.css');
await cp('public/assets', 'dist/assets', { recursive: true });
await cp('favicon.svg', 'dist/favicon.svg');
for (const name of ['@capacitor/core', '@capacitor/haptics', '@capacitor/preferences', '@capacitor/screen-orientation', '@capacitor-community/keep-awake']) {
  await cp(`node_modules/${name}/dist`, `dist/vendor/${name}/dist`, { recursive: true });
}

async function normalizeModuleSpecifiers(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await normalizeModuleSpecifiers(path);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const source = await readFile(path, 'utf8');
      const normalized = source.replace(
        /((?:from\s*|import\s*\()\s*['"])(\.{1,2}\/[^'"]+)(['"]\s*\)?)/g,
        (match, prefix, specifier, suffix) => /\.[a-z\d]+$/i.test(specifier) ? match : `${prefix}${specifier}.js${suffix}`,
      );
      if (normalized !== source) await writeFile(path, normalized);
    }
  }
}

await normalizeModuleSpecifiers('dist/vendor');
console.log('Web modules and browser-compatible Capacitor imports copied to dist/.');
