import * as esbuild from 'esbuild';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// Bundle main process
await esbuild.build({
  entryPoints: [join(rootDir, 'electron/main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: join(rootDir, 'dist_electron/main.js'),
  external: ['electron'],
  format: 'cjs',
  sourcemap: false,
});

// Bundle preload
await esbuild.build({
  entryPoints: [join(rootDir, 'electron/preload.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: join(rootDir, 'dist_electron/preload.js'),
  external: ['electron'],
  format: 'cjs',
  sourcemap: false,
});

console.log('Electron files built successfully');
