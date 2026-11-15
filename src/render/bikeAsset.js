// Loads the baked bike mesh produced by tools/build-bike.mjs (public/models/bike.json + bike.bin).
import * as THREE from 'three';

const std = (color, roughness, metalness, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

/** Resolves to { axle: {front, rear}, parts: { body, front, rear } }, each part a list of { geo, mat }. mat null = rider paint. */
export async function loadBikeAsset(base = '/models/bike') {
  const [info, buf] = await Promise.all([
    fetch(`${base}.json`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
    fetch(`${base}.bin`).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }),
  ]);
  // shared by every bike
  const mats = {
    paint: null,
    black: std(0x15161a, 0.5, 0.25),
    darkmetal: std(0x41444c, 0.38, 0.85),
    steel: std(0xbfc4cd, 0.28, 0.9),
    tyre: std(0x0c0c0d, 0.92, 0),
    glass: std(0x10161e, 0.05, 0.6, { transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
    lamp: std(0xfff6d8, 0.3, 0, { emissive: 0xfff0c0, emissiveIntensity: 1.4 }),
    tail: std(0xff2a1a, 0.3, 0, { emissive: 0xff1a0a, emissiveIntensity: 0.7 }),
  };
  const parts = { body: [], front: [], rear: [] };
  for (const m of info.meshes) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, m.pos[0], m.pos[1]), 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, m.idx[0], m.idx[1]), 1));
    geo.computeVertexNormals();
    parts[m.part].push({ geo, mat: mats[m.mat] });
  }
  return { axle: info.axle, credit: info.credit, parts };
}
