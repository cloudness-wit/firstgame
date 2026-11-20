import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webDir = resolve(projectRoot, 'dist');
const requiredFiles = [
  'index.html', 'style.css', 'game.js', 'audio.js', 'mobile.js', 'gameRules.js', 'favicon.svg',
  'assets/frames/idle.png', 'assets/frames/walk.png', 'assets/frames/run8.png',
  'assets/frames/jump.png', 'assets/frames/platform-ref.png',
  'vendor/@capacitor/core/dist/index.js',
  'vendor/@capacitor/haptics/dist/esm/index.js',
  'vendor/@capacitor/preferences/dist/esm/index.js',
  'vendor/@capacitor/screen-orientation/dist/esm/index.js',
  'vendor/@capacitor-community/keep-awake/dist/esm/index.js',
];

for (const file of requiredFiles) {
  const filePath = resolve(webDir, file);
  assert.ok((await stat(filePath)).isFile(), `Missing required build file: ${file}`);
}

const html = await readFile(resolve(webDir, 'index.html'), 'utf8');
assert.match(html, /<script type="module" src="\.\/game\.js"><\/script>/, 'Web entry must load the emitted game module.');
assert.doesNotMatch(html, /\.\/dist\/(?:game\.js|vendor\/)/, 'Built HTML must not contain source-tree module paths.');

const game = await readFile(resolve(webDir, 'game.js'), 'utf8');
for (const module of ['./audio.js', './mobile.js', './gameRules.js']) {
  assert.ok(game.includes(module), `Game module is missing its import: ${module}`);
}

async function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(fullPath, relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

const webFiles = await listFiles(webDir);
for (const target of ['android/app/src/main/assets/public', 'ios/App/App/public']) {
  const platformDir = resolve(projectRoot, target);
  const pathFromRoot = relative(projectRoot, platformDir);
  assert.ok(pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`), `Invalid platform output: ${target}`);
  for (const file of webFiles) {
    const [webContents, platformContents] = await Promise.all([
      readFile(resolve(webDir, file)),
      readFile(resolve(platformDir, file)),
    ]);
    assert.deepEqual(platformContents, webContents, `${target} is stale at ${file}`);
  }
}

console.log(`Build validation passed: ${webFiles.length} web files and Android/iOS copies verified.`);
