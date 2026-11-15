// Slims a downloaded Mixamo-rigged glTF character into a game-ready skinned mesh:
//   node tools/build-rider.mjs [assets/racer_bikecar] [targetTriangles]
//   python tools/shrink-texture.py assets/racer_bikecar/textures/Ch20_body_diffuse.png public/models/rider.jpg
// Keeps the skeleton and skin weights, drops the animation, tangents and spare UV sets, simplifies the mesh,
// and points the material at one small colour texture.
// Output: public/models/rider.gltf + rider.bin (+ rider.jpg from the texture step).
import fs from 'node:fs';
import path from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';

const SRC = process.argv[2] ?? 'assets/racer_bikecar';
const TARGET = Number(process.argv[3] ?? 14000);
const OUT = 'public/models';

const gltf = JSON.parse(fs.readFileSync(path.join(SRC, 'scene.gltf'), 'utf8'));
const bin = fs.readFileSync(path.join(SRC, gltf.buffers[0].uri));

const SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const GET = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' };
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function read(index) {
  const a = gltf.accessors[index], bv = gltf.bufferViews[a.bufferView];
  const size = SIZE[a.componentType], w = WIDTH[a.type];
  const stride = bv.byteStride || size * w;
  const dv = new DataView(bin.buffer, bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0), stride * (a.count - 1) + size * w);
  const norm = a.normalized ? 1 / (2 ** (size * 8) - 1) : 1;
  const out = new Float32Array(a.count * w);
  for (let i = 0; i < a.count; i++) for (let j = 0; j < w; j++) out[i * w + j] = dv[GET[a.componentType]](i * stride + j * size, true) * norm;
  return out;
}

const prim = gltf.meshes[0].primitives[0];
const src = {
  POSITION: read(prim.attributes.POSITION), NORMAL: read(prim.attributes.NORMAL), TEXCOORD_0: read(prim.attributes.TEXCOORD_0),
  JOINTS_0: read(prim.attributes.JOINTS_0), WEIGHTS_0: read(prim.attributes.WEIGHTS_0),
};
const srcIdx = Uint32Array.from(read(prim.indices));

await MeshoptSimplifier.ready;
let [idx] = MeshoptSimplifier.simplify(srcIdx, src.POSITION, 3, TARGET * 3, 0.01);

// keep only the vertices still in use
const count = src.POSITION.length / 3, remap = new Int32Array(count).fill(-1);
let used = 0;
for (const i of idx) if (remap[i] < 0) remap[i] = used++;
const pick = (arr, w, T) => {
  const out = new T(used * w);
  for (let v = 0; v < count; v++) if (remap[v] >= 0) for (let j = 0; j < w; j++) out[remap[v] * w + j] = arr[v * w + j];
  return out;
};
const outIdx = Uint16Array.from(idx, (i) => remap[i]);
if (used > 65535) throw new Error('too many vertices for 16-bit indices');
const pos = pick(src.POSITION, 3, Float32Array);

// ------------------------------------------------------------------ write a fresh buffer + accessors
const chunks = [], bufferViews = [], accessors = [];
let offset = 0;
function push(typed, type, componentType, target, extra = {}) {
  const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  const pad = (4 - (buf.length % 4)) % 4;
  bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target ? { target } : {}) });
  accessors.push({ bufferView: bufferViews.length - 1, componentType, count: typed.length / WIDTH[type], type, ...extra });
  chunks.push(buf, Buffer.alloc(pad));
  offset += buf.length + pad;
  return accessors.length - 1;
}
const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < pos.length; i++) { lo[i % 3] = Math.min(lo[i % 3], pos[i]); hi[i % 3] = Math.max(hi[i % 3], pos[i]); }
const attributes = {
  POSITION: push(pos, 'VEC3', 5126, 34962, { min: lo, max: hi }),
  NORMAL: push(pick(src.NORMAL, 3, Float32Array), 'VEC3', 5126, 34962),
  TEXCOORD_0: push(pick(src.TEXCOORD_0, 2, Float32Array), 'VEC2', 5126, 34962),
  JOINTS_0: push(pick(src.JOINTS_0, 4, Uint8Array), 'VEC4', 5121, 34962),
  WEIGHTS_0: push(pick(src.WEIGHTS_0, 4, Float32Array), 'VEC4', 5126, 34962),
};
const indices = push(outIdx, 'SCALAR', 5123, 34963);
const skin = gltf.skins[0];
const ibm = push(read(skin.inverseBindMatrices), 'MAT4', 5126, 0);

const out = {
  asset: { version: '2.0', generator: 'tools/build-rider.mjs', extras: gltf.asset.extras },
  scene: 0,
  scenes: gltf.scenes,
  nodes: gltf.nodes,
  skins: [{ ...skin, inverseBindMatrices: ibm }],
  meshes: [{ name: 'rider', primitives: [{ attributes, indices, material: 0 }] }],
  materials: [{ name: 'suit', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.62 } }],
  textures: [{ source: 0, sampler: 0 }],
  images: [{ uri: 'rider.jpg' }],
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
  buffers: [{ uri: 'rider.bin', byteLength: offset }],
  bufferViews, accessors,
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'rider.bin'), Buffer.concat(chunks));
fs.writeFileSync(path.join(OUT, 'rider.gltf'), JSON.stringify(out));
console.log(`${srcIdx.length / 3} -> ${outIdx.length / 3} tris, ${count} -> ${used} verts, ${(offset / 1024).toFixed(0)} KB`);
console.log('bounds', lo.map((v) => v.toFixed(1)), hi.map((v) => v.toFixed(1)));
