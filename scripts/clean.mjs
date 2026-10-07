import { rm } from 'node:fs/promises';

const rootDir = new URL('..', import.meta.url);
for (const directory of ['dist', 'dist_electron', 'release']) {
  await rm(new URL(`${directory}/`, rootDir), { recursive: true, force: true });
}
