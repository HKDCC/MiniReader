import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const staging = path.join(root, '.staging-asar');

if (fs.existsSync(staging)) {
  fs.rmSync(staging, { recursive: true, force: true });
}
fs.mkdirSync(staging, { recursive: true });

// Copy dist, dist_electron, package.json
fs.cpSync(path.join(root, 'dist'), path.join(staging, 'dist'), { recursive: true });
fs.cpSync(path.join(root, 'dist_electron'), path.join(staging, 'dist_electron'), { recursive: true });
fs.copyFileSync(path.join(root, 'package.json'), path.join(staging, 'package.json'));

console.log('Staging files prepared. Packing with asar...');
const targetAsar = path.join(root, '..', 'resources', 'app.asar.new');
const finalAsar = path.join(root, '..', 'resources', 'app.asar');
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const backupAsar = path.join(root, '..', 'resources', `app.asar.before-ai-explain-${stamp}.bak`);

execSync(`npx asar pack "${staging}" "${targetAsar}"`, { stdio: 'inherit', cwd: root });

// Clean staging
fs.rmSync(staging, { recursive: true, force: true });

if (fs.existsSync(finalAsar)) {
  fs.copyFileSync(finalAsar, backupAsar);
  console.log(`Backed up old asar to ${backupAsar}`);
}
// Windows 上 app.asar 常被只读句柄占用，rename 会 EPERM/EBUSY；
// 但写入是允许的，所以优先原地覆盖，失败再退回 rename。
try {
  fs.copyFileSync(targetAsar, finalAsar);
  fs.rmSync(targetAsar, { force: true });
} catch {
  fs.renameSync(targetAsar, finalAsar);
}
console.log('Packed and deployed to app.asar successfully!');
