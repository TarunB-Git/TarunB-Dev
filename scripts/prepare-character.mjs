/* Keep only the animation clips used by the Cloud controller. The untouched
   CC0 source model remains in reference_assets for future character work. */
import { NodeIO } from '@gltf-transform/core';

const [input, output, mode] = process.argv.slice(2);
if (!input || !output) throw new Error('usage: node scripts/prepare-character.mjs input.glb output.glb');

const keep = new Set(['Idle', 'Walking_A', 'Running_A', 'Jump_Start', 'Jump_Idle', 'Jump_Land', 'Interact']);
const io = new NodeIO();
const document = await io.read(input);
const root = document.getRoot();
root.getAsset().extras = {
  title: 'KayKit Character Pack: Adventurers — Mage',
  creator: 'Kay Lousberg (KayKit)',
  source: 'https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0',
  license: 'CC0-1.0',
};
if (mode !== '--keep-all') {
  for (const animation of root.listAnimations()) {
    if (!keep.has(animation.getName())) animation.dispose();
  }
}
await io.write(output, document);
console.log(`kept ${root.listAnimations().map(animation => animation.getName()).join(', ')}`);
