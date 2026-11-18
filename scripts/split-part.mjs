// Move the triangles of a part that lie in a region into a new node that stays with the hull
// (keeps the part's material, so the textures stay right).
//
//   node scripts/split-part.mjs in.glb out.glb Part NewName "y<1.3"
//
// The condition is a JavaScript expression on the triangle's centre (x, y, z) in the model's
// frame (its units, after the node's own transform). The new node keeps the part's transform.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const [, , input, output, name, newName, cond] = process.argv;
const test = new Function('x', 'y', 'z', `return ${cond};`);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const node = doc.getRoot().listNodes().find((n) => n.getName() === name);
if (!node?.getMesh()) throw new Error(`no mesh node ${name}`);
const m = node.getWorldMatrix();
const tf = (v) => [0, 1, 2].map((d) => m[d] * v[0] + m[4 + d] * v[1] + m[8 + d] * v[2] + m[12 + d]);
const mesh = doc.createMesh(newName);
const lo = [Infinity, Infinity, Infinity];
const hi = [-Infinity, -Infinity, -Infinity];
let moved = 0;
for (const prim of node.getMesh().listPrimitives()) {
  const pos = prim.getAttribute('POSITION');
  const idx = prim.getIndices();
  const tri = idx.getArray();
  const keep = [];
  const out = [];
  const el = [];
  for (let t = 0; t < tri.length; t += 3) {
    let cx = 0, cy = 0, cz = 0;
    const w = [0, 1, 2].map((k) => tf(pos.getElement(tri[t + k], el)));
    for (const v of w) { cx += v[0] / 3; cy += v[1] / 3; cz += v[2] / 3; }
    const hit = test(cx, cy, cz);
    (hit ? out : keep).push(tri[t], tri[t + 1], tri[t + 2]);
    if (hit) for (const v of w) for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], v[d]); hi[d] = Math.max(hi[d], v[d]); }
  }
  if (!out.length) continue;
  moved += out.length / 3;
  const Arr = tri.constructor;
  idx.setArray(new Arr(keep));
  const p2 = prim.clone();
  p2.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Arr(out)).setBuffer(idx.getBuffer()));
  mesh.addPrimitive(p2);
}
const n2 = doc.createNode(newName).setMesh(mesh).setTranslation(node.getTranslation()).setRotation(node.getRotation()).setScale(node.getScale());
(node.getParentNode() ?? doc.getRoot().listScenes()[0]).addChild(n2);
await io.write(output, doc);
console.log(`${moved} triangles moved from ${name} to ${newName}, bounds`, lo.map((v) => +v.toFixed(2)), hi.map((v) => +v.toFixed(2)));
