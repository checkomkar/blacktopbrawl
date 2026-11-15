// Roadside town: shop/apartment blocks downtown, homes with pitched roofs in the suburbs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STEP, mulberry32 } from '../sim/track.js';

/** true = downtown block, false = suburb. i = centreline sample index. */
export const townZone = (i) => Math.sin(i * 0.006 + 0.5) + 0.5 * Math.sin(i * 0.017) > 0;

const BAY = 4, FLOOR = 3.4;      // metres per facade tile

function tile(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
const glass = (g, x, y, w, h, top, bottom) => {
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, top); gr.addColorStop(1, bottom);
  g.fillStyle = gr;
  g.fillRect(x, y, w, h);
};
const TILES = {
  apt: (g) => {
    g.fillStyle = '#e9e5dc'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(0,0,0,.08)'; for (let y = 0; y < 128; y += 16) g.fillRect(0, y, 128, 1);
    g.fillStyle = '#fbfbf8'; g.fillRect(34, 24, 60, 76);
    glass(g, 39, 29, 50, 66, '#2a3a4e', '#5b7289');
    g.fillStyle = '#fbfbf8'; g.fillRect(62, 29, 4, 66); g.fillRect(39, 58, 50, 4);
    g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(30, 100, 68, 5);
  },
  office: (g) => {
    g.fillStyle = '#d4d8db'; g.fillRect(0, 0, 128, 128);
    glass(g, 5, 16, 118, 96, '#33506c', '#7397b6');
    g.fillStyle = '#d4d8db'; g.fillRect(62, 16, 4, 96);
    g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.moveTo(5, 112); g.lineTo(50, 16); g.lineTo(74, 16); g.lineTo(29, 112); g.fill();
  },
  shop: (g) => {
    g.fillStyle = '#e9e5dc'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(0,0,0,.42)'; g.fillRect(0, 0, 128, 26);
    g.fillStyle = 'rgba(255,255,255,.75)'; g.fillRect(22, 9, 84, 8);
    glass(g, 9, 34, 110, 82, '#1f2c38', '#48607a');
    g.fillStyle = '#e9e5dc'; g.fillRect(74, 34, 5, 82);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 116, 128, 12);
  },
};

const WALLS = [0xb5634a, 0xd9b98a, 0xe8dcc0, 0xa9aeb3, 0x8fa3b8, 0xd99a8a, 0xa7b08a, 0xf0ede6, 0x9c5a4a, 0xc9a66b];
const HOUSE = [0xf2e6c8, 0xdfe9ef, 0xf3d9cf, 0xe3efd6, 0xf7f3ea, 0xe9d8b4, 0xcfe0e8];
const ROOFS = [0x8a3b2e, 0x3d3f47, 0x6a4a36, 0x4f5d52, 0x7a2f2f];
const AWNINGS = [0xc0392b, 0x1f6f8b, 0x2e7d32, 0xe0a81c, 0x6b3fa0];

/** Accumulates textured wall quads (world space, tinted per building). */
class Walls {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; }
  /** Four walls of a box footprint w (along the road, local z) x dp (local x), from y0 to y1. */
  box(m, w, dp, y0, y1, color, vBase = 0) {
    const hx = dp / 2, hz = w / 2;
    const ring = [[hx, hz], [hx, -hz], [-hx, -hz], [-hx, hz]];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color(color);
    for (let f = 0; f < 4; f++) {
      const p = ring[f], q = ring[(f + 1) % 4];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const nu = Math.max(1, Math.round(len / BAY));
      const v0 = (y0 - vBase) / FLOOR, v1 = (y1 - vBase) / FLOOR;
      a.set(p[0], 0, p[1]).applyMatrix4(m);
      b.set(q[0], 0, q[1]).applyMatrix4(m);
      n.set(b.x - a.x, 0, b.z - a.z).normalize();
      n.set(-n.z, 0, n.x);                               // dir x up
      const V = [[a.x, y0, a.z, 0, v0], [b.x, y0, b.z, nu, v0], [b.x, y1, b.z, nu, v1], [a.x, y1, a.z, 0, v1]];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const e = V[k];
        this.pos.push(e[0], e[1], e[2]); this.uv.push(e[3], e[4]);
        this.nor.push(n.x, 0, n.z); this.col.push(c.r, c.g, c.b);
      }
    }
  }
  mesh(map) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }
}

function paint(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

export function buildTown(track, group) {
  const rnd = mulberry32(505);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const walls = { apt: new Walls(), office: new Walls(), shop: new Walls() };
  const solids = [];
  const S = {}, m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const solid = (geo, color) => solids.push(paint(geo, color).applyMatrix4(m));
  const boxAt = (sx, sy, sz, x, y, z, color) => solid(new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z), color);

  /** Sets `m` to a frame at (s, d): local +x faces the road, local z runs along it. */
  const frame = (s, d) => {
    track.sample(s, S);
    pos.set(S.x - Math.cos(S.h) * d, 0, S.z + Math.sin(S.h) * d);
    q.setFromAxisAngle(up, S.h + (d > 0 ? 0 : Math.PI));
    m.compose(pos, q, one);
    return S.y;
  };

  const block = (s, side, setback, w, dp, floors, kind, shops) => {
    const y = frame(s, side * (setback + dp / 2));
    const base = y - 2.5, top = y + floors * FLOOR + 0.6;
    const color = pick(WALLS);
    if (shops) {
      walls.shop.box(m, w, dp, base, y + FLOOR, color, y);
      walls[kind].box(m, w, dp, y + FLOOR, top, color, y);
      if (rnd() < 0.7) boxAt(1.5, 0.16, w * 0.9, dp / 2 + 0.75, y + 2.9, 0, pick(AWNINGS));
    } else walls[kind].box(m, w, dp, base, top, color, y);
    boxAt(dp + 0.5, 0.4, w + 0.5, 0, top + 0.2, 0, 0x4a4b50);                    // roof slab
    if (rnd() < 0.5) boxAt(2.4, 1.6, 3, (rnd() - 0.5) * dp * 0.4, top + 1.2, (rnd() - 0.5) * w * 0.5, 0x8a8d92);  // roof plant
  };

  const house = (s, side, setback, w, dp, floors) => {
    const y = frame(s, side * (setback + dp / 2));
    const top = y + floors * FLOOR;
    walls.apt.box(m, w, dp, y - 2.5, top, pick(HOUSE), y);
    const rh = 1.8 + rnd() * 1.2, roof = pick(ROOFS);
    const shape = new THREE.Shape([new THREE.Vector2(-dp / 2 - 0.5, 0), new THREE.Vector2(dp / 2 + 0.5, 0), new THREE.Vector2(0, rh)]);
    solid(new THREE.ExtrudeGeometry(shape, { depth: w + 0.8, bevelEnabled: false }).translate(0, top, -(w + 0.8) / 2), roof);
    boxAt(0.7, 1.9, 0.7, -dp * 0.2, top + rh * 0.75, w * 0.28, 0x7a5a4a);        // chimney
    boxAt(0.14, 2.1, 1.05, dp / 2 + 0.05, y + 1.05, (rnd() - 0.5) * w * 0.4, pick(AWNINGS)); // front door
    boxAt(1.6, 0.25, 2.4, dp / 2 + 0.8, y + 0.12, 0, 0xb9b4aa);                  // step
    // low hedge along the front of the plot
    if (rnd() < 0.6) boxAt(0.7, 0.9, w + 3, dp / 2 + setback - 12.4, y + 0.45, 0, 0x3f6b2c);
  };

  for (const side of [-1, 1]) {
    // front row
    let s = 24;
    while (s < track.length - 30) {
      const i = Math.round(s / STEP), down = townZone(i);
      let w, dp, floors, setback, gap;
      if (down) { w = 12 + rnd() * 14; dp = 12 + rnd() * 6; floors = 2 + Math.floor(rnd() * rnd() * 6); setback = 12.6; gap = rnd() < 0.14 ? 7 : 0.4; }
      else { w = 9 + rnd() * 5; dp = 8 + rnd() * 3; floors = rnd() < 0.45 ? 2 : 1; setback = 17 + rnd() * 4; gap = 6 + rnd() * 8; }
      const d = side * (setback + dp / 2);
      const stretch = Math.max(0.5, 1 + track.sample(s, S).k * d);    // arc length at offset d per metre of road
      const sc = s + w / 2 / stretch;
      if (down) block(sc, side, setback, w, dp, floors, floors >= 5 && rnd() < 0.6 ? 'office' : 'apt', rnd() < 0.8);
      else house(sc, side, setback, w, dp, floors);
      s += (w + gap) / stretch;
    }
    // taller second row behind the downtown blocks, for a skyline
    s = 40;
    while (s < track.length - 40) {
      const i = Math.round(s / STEP);
      const w = 16 + rnd() * 10, dp = 14 + rnd() * 6, setback = 36;
      const d = side * (setback + dp / 2);
      const stretch = Math.max(0.5, 1 + track.sample(s, S).k * d);
      if (townZone(i) && rnd() < 0.75) block(s + w / 2 / stretch, side, setback, w, dp, 5 + Math.floor(rnd() * 9), rnd() < 0.7 ? 'office' : 'apt', false);
      s += (w + 3 + rnd() * 10) / stretch;
    }
  }

  for (const kind in walls) {
    if (!walls[kind].pos.length) continue;
    group.add(walls[kind].mesh(tile(TILES[kind])));
  }
  const mesh = new THREE.Mesh(mergeGeometries(solids), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
}
