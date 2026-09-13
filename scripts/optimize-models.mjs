import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modelRoot = join(root, 'static', 'assets', 'models');
const backupRoot = join(root, 'reference_assets', 'original_models');
const originals = ['ship_in_clouds.glb', 'old__ancient_scroll.glb', 'moon.glb', 'bird.glb'];
const optimizer = join(root, 'node_modules', '.bin', 'gltf-transform');

function containsAttribution(buffer) {
  const text = buffer.toString('utf8');
  return text.includes('CC-BY-4.0') || text.includes('creativecommons.org/licenses/by/4.0');
}

await mkdir(backupRoot, { recursive: true });
for (const filename of originals) {
  const source = join(modelRoot, filename);
  const backup = join(backupRoot, filename);
  const output = join(modelRoot, `${filename.replace(/\.glb$/, '')}.optimized.glb`);
  try { await stat(backup); } catch { await copyFile(source, backup); }
  await copyFile(backup, source);
  const before = await readFile(source);
  if (!containsAttribution(before)) throw new Error(`${filename} has no embedded CC BY attribution; refusing to optimize.`);
  await run(optimizer, ['optimize', source, output, '--compress', 'meshopt', '--texture-compress', 'webp']);
  const after = await readFile(output);
  if (!containsAttribution(after)) {
    await rm(output, { force: true });
    throw new Error(`${filename} lost embedded attribution; original retained.`);
  }
  if (after.byteLength >= before.byteLength) {
    await rm(output, { force: true });
    console.log(`${filename}: retained original (${before.byteLength} bytes)`);
    continue;
  }
  await rename(output, source);
  console.log(`${filename}: ${before.byteLength} -> ${after.byteLength} bytes`);
}

// v4.4.2 writes sidecars when an output has an unrecognized extension. Older
// revisions of this script used one; remove only those known generated files.
for (const generated of [
  'baseColor_1.webp', 'baseColor_2.webp', 'bird.glb.bin', 'diffuse.webp',
  'emissive_1.webp', 'emissive_2.webp', 'emissive_3.webp', 'emissive_4.webp',
  'emissive_5.webp', 'emissive_6.webp', 'metallicRoughness_1.webp',
  'moon.glb.bin', 'normal_1.webp', 'old__ancient_scroll.glb.bin',
  'ship_in_clouds.glb.bin',
]) await rm(join(modelRoot, generated), { force: true });
