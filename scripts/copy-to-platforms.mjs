import { cp, mkdir } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webDir = resolve(projectRoot, 'dist');
const destinations = [
  resolve(projectRoot, 'android/app/src/main/assets/public'),
  resolve(projectRoot, 'ios/App/App/public'),
];

for (const destination of destinations) {
  const relativePath = relative(projectRoot, destination);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    throw new Error(`Refusing to copy the web build outside the project: ${destination}`);
  }
  await mkdir(destination, { recursive: true });
  await cp(webDir, destination, { recursive: true, force: true });
}

console.log('Web build copied to Android and iOS public asset folders.');
