// Bakes a downloaded glTF motorcycle into a small game-ready mesh:
//   node tools/build-bike.mjs [assets/bmw_s1000_rr] [targetTriangles]
// - poses the skinned parts in their bind pose and bakes them to static geometry
// - splits it into body / front wheel / rear wheel so the wheels can spin
// - groups the ~70 source materials into a handful of flat-colour buckets (paint takes the rider colour)
// - drops logo decals and badges, and simplifies everything to a triangle budget
// Output: public/models/bike.json + bike.bin (see src/render/bikeAsset.js for the loader).
import fs from 'node:fs';
import path from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';

const SRC = process.argv[2] ?? 'assets/bmw_s1000_rr';
const TARGET = Number(process.argv[3] ?? 34000);
const OUT = 'public/models';
const REAR_Z = -0.68, FRONT_Z = 0.72;        // axle positions used by the game's bike rig

const gltf = JSON.parse(fs.readFileSync(path.join(SRC, 'scene.gltf'), 'utf8'));
const bin = fs.readFileSync(path.join(SRC, gltf.buffers[0].uri));

// ------------------------------------------------------------------ glTF reading
const COMP = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function read(index) {
  const a = gltf.accessors[index], bv = gltf.bufferViews[a.bufferView];
  const [T, size] = COMP[a.componentType], w = WIDTH[a.type];
  const stride = bv.byteStride || size * w, base = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new Float64Array(a.count * w);
  const dv = new DataView(bin.buffer, base, stride * (a.count - 1) + size * w);
  const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
  const norm = a.normalized ? 1 / (2 ** (size * 8) - 1) : 1;
  for (let i = 0; i < a.count; i++) for (let j = 0; j < w; j++) out[i * w + j] = dv[get](i * stride + j * size, true) * norm;
  return out;
}

// column-major 4x4 helpers
const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
function local(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1], [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
const world = new Array(gltf.nodes.length), parent = new Array(gltf.nodes.length).fill(-1);
const visit = (i, m) => {
  world[i] = mul(m, local(gltf.nodes[i]));
  for (const c of gltf.nodes[i].children ?? []) { parent[c] = i; visit(c, world[i]); }
};
for (const r of gltf.scenes[gltf.scene ?? 0].nodes) visit(r, ident());

// ------------------------------------------------------------------ classification
function bucket(mat) {
  const n = mat.name;
  if (/decal_logo|vehicle_badges/.test(n)) return null;                       // maker branding: left out
  if (/_PRIMARY|^plastic\.003$/.test(n)) return 'paint';
  if (/tyres/.test(n)) return 'tyre';
  if (/^glass_500px/.test(n)) return 'glass';
  if (/headlight_glass|smallspecmap\.022/.test(n)) return null;               // clear lens covers
  if (/^rgbab60000ff/.test(n)) return 'tail';
  if (/smallspecmap\.02[45]$/.test(n)) return 'lamp';
  if (/engine|exhaust|chain|brakes|gear/.test(n)) return 'darkmetal';
  if (/gold-texture|vehicle_paint1|_DASHBOARD|smallspecmap\.(008|016|017|023)$|braided/.test(n)) return 'steel';
  return 'black';
}
const partOf = (name) => (/wheel_lf|bikedisc_f/.test(name) ? 'front' : /wheel_lr|bikedisc_r/.test(name) ? 'rear' : 'body');

// ------------------------------------------------------------------ bake every primitive to world space
const groups = {};                       // `${part}/${bucket}` -> { pos: [], idx: [] }
let srcTris = 0;
for (let ni = 0; ni < gltf.nodes.length; ni++) {
  const node = gltf.nodes[ni];
  if (node.mesh == null) continue;
  const skin = node.skin != null ? gltf.skins[node.skin] : null;
  const jm = skin && (() => {
    const ibm = read(skin.inverseBindMatrices);
    return skin.joints.map((j, k) => mul(world[j], Array.from(ibm.subarray(k * 16, k * 16 + 16))));
  })();
  for (const prim of gltf.meshes[node.mesh].primitives) {
    const b = bucket(gltf.materials[prim.material]);
    const P = read(prim.attributes.POSITION), count = P.length / 3;
    const I = prim.indices != null ? read(prim.indices) : Float64Array.from({ length: count }, (_, i) => i);
    srcTris += I.length / 3;
    if (!b) continue;
    let part = 'body';
    const out = new Float64Array(P.length);
    if (skin) {
      const J = read(prim.attributes.JOINTS_0), W = read(prim.attributes.WEIGHTS_0);
      const votes = {};
      for (let v = 0; v < count; v++) {
        let x = 0, y = 0, z = 0, best = 0, bestW = -1;
        for (let k = 0; k < 4; k++) {
          const w = W[v * 4 + k];
          if (!w) continue;
          const m = jm[J[v * 4 + k]], px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2];
          x += w * (m[0] * px + m[4] * py + m[8] * pz + m[12]);
          y += w * (m[1] * px + m[5] * py + m[9] * pz + m[13]);
          z += w * (m[2] * px + m[6] * py + m[10] * pz + m[14]);
          if (w > bestW) { bestW = w; best = J[v * 4 + k]; }
        }
        out.set([x, y, z], v * 3);
        votes[best] = (votes[best] ?? 0) + 1;
      }
      const top = Object.entries(votes).sort((a, c) => c[1] - a[1])[0][0];
      part = partOf(gltf.nodes[skin.joints[top]].name);
    } else {
      const m = world[ni];
      for (let v = 0; v < count; v++) {
        const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2];
        out.set([m[0] * px + m[4] * py + m[8] * pz + m[12], m[1] * px + m[5] * py + m[9] * pz + m[13], m[2] * px + m[6] * py + m[10] * pz + m[14]], v * 3);
      }
      for (let a = ni; a >= 0; a = parent[a]) { const p = partOf(gltf.nodes[a].name ?? ''); if (p !== 'body') { part = p; break; } }
    }
    const g = (groups[`${part}/${b}`] ??= { pos: [], idx: [] });
    const base = g.pos.length / 3;
    for (const v of out) g.pos.push(v);
    for (const i of I) g.idx.push(base + i);
  }
}

// ------------------------------------------------------------------ normalise: +Z forward, wheels on the ground, game wheelbase
const bounds = (pos) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) { const a = i % 3; lo[a] = Math.min(lo[a], pos[i]); hi[a] = Math.max(hi[a], pos[i]); }
  return { lo, hi, mid: lo.map((v, a) => (v + hi[a]) / 2) };
};
const fb = bounds(groups['front/tyre'].pos), rb = bounds(groups['rear/tyre'].pos);
const flip = fb.mid[2] < rb.mid[2] ? -1 : 1;                 // model may face -Z
const scale = (FRONT_Z - REAR_Z) / Math.abs(fb.mid[2] - rb.mid[2]);
const ground = Math.min(fb.lo[1], rb.lo[1]);
const zShift = REAR_Z - rb.mid[2] * flip * scale;
for (const g of Object.values(groups)) {
  for (let i = 0; i < g.pos.length; i += 3) {
    g.pos[i] = g.pos[i] * flip * scale;                      // flipping x and z together = a half turn about Y
    g.pos[i + 1] = (g.pos[i + 1] - ground) * scale;
    g.pos[i + 2] = g.pos[i + 2] * flip * scale + zShift;
  }
}
const axle = {};
for (const part of ['front', 'rear']) {
  const b = bounds(groups[`${part}/tyre`].pos);
  axle[part] = { y: b.mid[1], z: b.mid[2], r: (b.hi[1] - b.lo[1]) / 2 };
  for (const key in groups) {
    if (!key.startsWith(part + '/')) continue;
    const p = groups[key].pos;
    for (let i = 0; i < p.length; i += 3) { p[i + 1] -= axle[part].y; p[i + 2] -= axle[part].z; }   // wheel meshes sit on their axle
  }
}

// ------------------------------------------------------------------ weld + simplify
await MeshoptSimplifier.ready;
function weld(g) {
  const map = new Map(), pos = [], remap = new Uint32Array(g.pos.length / 3);
  for (let v = 0; v < remap.length; v++) {
    const x = g.pos[v * 3], y = g.pos[v * 3 + 1], z = g.pos[v * 3 + 2];
    const key = `${Math.round(x * 4000)},${Math.round(y * 4000)},${Math.round(z * 4000)}`;
    let id = map.get(key);
    if (id === undefined) { id = pos.length / 3; map.set(key, id); pos.push(x, y, z); }
    remap[v] = id;
  }
  const idx = [];
  for (let t = 0; t < g.idx.length; t += 3) {
    const a = remap[g.idx[t]], b = remap[g.idx[t + 1]], c = remap[g.idx[t + 2]];
    if (a !== b && b !== c && a !== c) idx.push(a, b, c);
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}
const welded = Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, weld(g)]));
const total = Object.values(welded).reduce((a, g) => a + g.idx.length / 3, 0);
const ratio = Math.min(1, TARGET / total);
const meshes = [], chunks = [];
let offset = 0, outTris = 0;
for (const [key, g] of Object.entries(welded)) {
  const [part, mat] = key.split('/');
  // painted bodywork is what you look at; glass and lamps are tiny: keep more of those
  const keep = mat === 'paint' ? 1 : mat === 'glass' || mat === 'lamp' || mat === 'tail' ? Math.max(ratio, 0.5) : ratio;
  const want = Math.max(36, Math.floor((g.idx.length / 3) * keep) * 3);
  let idx = g.idx;
  if (want < idx.length) {
    [idx] = MeshoptSimplifier.simplify(g.idx, g.pos, 3, want, 0.02);
    if (idx.length > want * 1.5) [idx] = MeshoptSimplifier.simplifySloppy(g.idx, g.pos, 3, want, 0.03);   // lots of loose bits: merge them
  }
  // compact the vertex buffer
  const remap = new Int32Array(g.pos.length / 3).fill(-1), pos = [];
  const out = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) {
    let id = remap[idx[i]];
    if (id < 0) { id = remap[idx[i]] = pos.length / 3; pos.push(g.pos[idx[i] * 3], g.pos[idx[i] * 3 + 1], g.pos[idx[i] * 3 + 2]); }
    out[i] = id;
  }
  const pb = Buffer.from(new Float32Array(pos).buffer), ib = Buffer.from(out.buffer);
  meshes.push({ part, mat, pos: [offset, pos.length], idx: [offset + pb.length, out.length] });
  chunks.push(pb, ib);
  offset += pb.length + ib.length;
  outTris += out.length / 3;
  console.log(key.padEnd(18), `${g.idx.length / 3} -> ${out.length / 3} tris`);
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'bike.bin'), Buffer.concat(chunks));
const credit = gltf.asset.extras ?? {};
fs.writeFileSync(path.join(OUT, 'bike.json'), JSON.stringify({ credit, axle, meshes }, null, 1));
const all = bounds(Object.entries(groups).filter(([k]) => k.startsWith('body/')).flatMap(([, g]) => g.pos));
console.log(`source ${srcTris} tris -> ${outTris} tris, ${(offset / 1024).toFixed(0)} KB`);
console.log('axles', JSON.stringify(axle), 'scale', scale.toFixed(3), 'flip', flip);
console.log('body bounds', all.lo.map((v) => v.toFixed(2)), all.hi.map((v) => v.toFixed(2)));
