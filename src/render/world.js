import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STEP, ROAD_HALF, terrainLift, mulberry32 } from '../sim/track.js';
import { buildTown, townZone } from './town.js';

const SUN_ELEV = 24, SUN_AZIM = 78; // degrees
const HAZE = 0xd8c7ae;

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

const ROAD_W = ROAD_HALF + 0.4;   // mesh half-width
const ROAD_TILE = 24;             // metres of road per texture repeat

function roadTexture() {
  return canvasTex(512, 1024, (g, W, H) => {
    const rnd = mulberry32(3);
    g.fillStyle = '#303034';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 14000; i++) {
      const v = 30 + rnd() * 50;
      g.fillStyle = `rgba(${v},${v},${v + 3},${0.25 + rnd() * 0.4})`;
      g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    const X = (m) => ((m + ROAD_W) / (2 * ROAD_W)) * W;
    const Y = (m) => (m / ROAD_TILE) * H;
    // worn wheel tracks
    for (const m of [-4.5, -1.5, 1.5, 4.5]) {
      const gr = g.createLinearGradient(X(m - 1.1), 0, X(m + 1.1), 0);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(0.5, 'rgba(0,0,0,0.22)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(X(m - 1.1), 0, X(2.2) - X(0), H);
    }
    const line = (m, w, color, y0 = 0, y1 = ROAD_TILE) => {
      g.fillStyle = color;
      g.fillRect(X(m - w / 2), Y(y0), X(w) - X(0), Y(y1 - y0));
    };
    line(-5.75, 0.16, '#d9d6cc');
    line(5.75, 0.16, '#d9d6cc');
    line(-0.14, 0.13, '#e0a81c');
    line(0.14, 0.13, '#e0a81c');
    for (const m of [-3, 3]) {
      line(m, 0.13, '#d9d6cc', 0, 3.5);
      line(m, 0.13, '#d9d6cc', 12, 15.5);
    }
  });
}

function grainTexture() {
  return canvasTex(256, 256, (g, W, H) => {
    const rnd = mulberry32(9);
    g.fillStyle = '#e4e4e4';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 9000; i++) {
      const v = 150 + rnd() * 105;
      g.fillStyle = `rgba(${v},${v},${v},0.5)`;
      g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 1 + rnd() * 3);
    }
  });
}

function buildRoad(track) {
  const n = track.n;
  const pos = new Float32Array(n * 6), uv = new Float32Array(n * 4);
  const idx = new Uint32Array((n - 1) * 6);
  for (let i = 0; i < n; i++) {
    const h = track.h[i], rx = -Math.cos(h), rz = Math.sin(h);
    for (let j = 0; j < 2; j++) {
      const d = j ? ROAD_W : -ROAD_W;
      pos.set([track.px[i] + rx * d, track.py[i], track.pz[i] + rz * d], (i * 2 + j) * 3);
      uv.set([j, (i * STEP) / ROAD_TILE], (i * 2 + j) * 2);
    }
    if (i < n - 1) {
      const a = i * 2;
      idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.82 }));
  mesh.receiveShadow = true;
  return mesh;
}

const COLS = [-140, -95, -60, -35, -20, -13, -9.5, -6.6, -5, 0, 5, 6.6, 9.5, 13, 20, 35, 60, 95, 140];

function buildGround(track) {
  const n = track.n, c = COLS.length;
  const pos = new Float32Array(n * c * 3), col = new Float32Array(n * c * 3), uv = new Float32Array(n * c * 2);
  const idx = new Uint32Array((n - 1) * (c - 1) * 6);
  const gravel = new THREE.Color(0x8d7d66), grassA = new THREE.Color(0x4f6b27), grassB = new THREE.Color(0x8a8440);
  const rock = new THREE.Color(0x77705f), tmp = new THREE.Color();
  const town = track.theme === 'town';
  const concrete = new THREE.Color(0xa29f97), paving = new THREE.Color(0x75726d), lawn = new THREE.Color(0x5f8f38);
  let q = 0;
  for (let i = 0; i < n; i++) {
    const h = track.h[i], rx = -Math.cos(h), rz = Math.sin(h);
    for (let j = 0; j < c; j++) {
      const d = COLS[j], a = Math.abs(d), v = i * c + j;
      const x = track.px[i] + rx * d, z = track.pz[i] + rz * d;
      const lift = terrainLift(d, x, z, track.flat);
      pos.set([x, track.py[i] + lift - (a <= 5 ? 0.25 : 0), z], v * 3);
      uv.set([x / 7, z / 7], v * 2);
      const nz = 0.5 + 0.5 * Math.sin(x * 0.02 + Math.sin(z * 0.015) * 2);
      tmp.copy(grassA).lerp(grassB, nz);
      if (lift > 22) tmp.lerp(rock, Math.min(1, (lift - 22) / 10));
      if (town) {
        // pavement beside the road, then paved blocks downtown or lawns in the suburbs
        if (a < 58) tmp.lerp(townZone(i) ? paving : lawn, Math.min(1, (58 - a) / 20));
        tmp.lerpColors(concrete, tmp.clone(), Math.min(1, Math.max(0, (a - 13) / 5)));
      } else {
        const t = Math.min(1, Math.max(0, (a - 8.5) / 5));
        tmp.lerpColors(gravel, tmp.clone(), t);
      }
      col.set([tmp.r, tmp.g, tmp.b], v * 3);
      if (i < n - 1 && j < c - 1) {
        idx.set([v, v + 1, v + c, v + 1, v + c + 1, v + c], q);
        q += 6;
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: grainTexture(), roughness: 1 }));
  mesh.receiveShadow = true;
  return mesh;
}

function paint(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

function sceneryGeos() {
  const pine = [paint(new THREE.CylinderGeometry(0.18, 0.3, 2.4, 6).translate(0, 1.2, 0), 0x5a4030)];
  for (let j = 0; j < 3; j++) {
    pine.push(paint(new THREE.ConeGeometry(2.3 - j * 0.6, 3.4, 7).translate(0, 3 + j * 1.9, 0), 0x2f5a2a));
  }
  const oak = [
    paint(new THREE.CylinderGeometry(0.22, 0.34, 3, 6).translate(0, 1.5, 0), 0x4e3a2a),
    paint(new THREE.IcosahedronGeometry(2.4, 1).scale(1, 0.85, 1).translate(0, 4.4, 0), 0x55772c),
    paint(new THREE.IcosahedronGeometry(1.6, 1).translate(1.3, 3.6, 0.6), 0x4c6d28),
  ];
  const rockG = [paint(new THREE.DodecahedronGeometry(1, 0).scale(1.3, 0.8, 1), 0x7c766c)];
  const pole = [
    paint(new THREE.CylinderGeometry(0.11, 0.15, 9, 6).translate(0, 4.5, 0), 0x4a3b2c),
    paint(new THREE.BoxGeometry(2.2, 0.14, 0.14).translate(0, 8.3, 0), 0x4a3b2c),
  ];
  const post = [
    paint(new THREE.BoxGeometry(0.12, 0.9, 0.12).translate(0, 0.45, 0), 0xe8e8e8),
    paint(new THREE.BoxGeometry(0.13, 0.16, 0.13).translate(0, 0.72, 0), 0xd0301c),
  ];
  const lamp = [
    paint(new THREE.CylinderGeometry(0.09, 0.13, 7.2, 6).translate(0, 3.6, 0), 0x3a3d44),
    paint(new THREE.BoxGeometry(2.6, 0.12, 0.12).translate(1.2, 7.2, 0), 0x3a3d44),
    paint(new THREE.BoxGeometry(0.9, 0.16, 0.36).translate(2.2, 7.08, 0), 0xfff2c4),
  ];
  return { pine: mergeGeometries(pine), oak: mergeGeometries(oak), rock: mergeGeometries(rockG), pole: mergeGeometries(pole), post: mergeGeometries(post), lamp: mergeGeometries(lamp) };
}

function buildScenery(track, scene) {
  const rnd = mulberry32(77);
  const geos = sceneryGeos();
  const town = track.theme === 'town';
  const FIXED = ['post', 'pole', 'lamp'];
  const lists = { pine: [], oak: [], rock: [], pole: [], post: [], lamp: [] };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const place = (kind, i, d, scale, tint = 1) => {
    const h = track.h[i];
    const x = track.px[i] - Math.cos(h) * d, z = track.pz[i] + Math.sin(h) * d;
    p.set(x, track.py[i] + terrainLift(d, x, z, track.flat) - (FIXED.includes(kind) ? 0 : 0.25), z);
    q.setFromAxisAngle(up, kind === 'lamp' ? h + (d > 0 ? 0 : Math.PI) : FIXED.includes(kind) ? h : rnd() * 6.28);
    s.set(scale, scale * (0.85 + rnd() * 0.3), scale);
    lists[kind].push({ m: m4.compose(p, q, s).clone(), tint });
  };
  for (let i = 4; i < track.n - 2; i += 2) {
    for (const side of [-1, 1]) {
      const zone = Math.sin(i * 0.011 + side) + Math.sin(i * 0.0037); // forest/meadow variation
      for (let t = 0; t < 2; t++) {
        if (rnd() > 0.42 + zone * 0.22) continue;
        const d = side * ((town ? 62 : 15) + Math.pow(rnd(), 1.4) * (town ? 75 : 118));
        const r = rnd();
        if (r < 0.1) place('rock', i, d, 0.6 + rnd() * 1.6, 0.8 + rnd() * 0.3);
        else place(zone > 0.2 === r < 0.8 ? 'pine' : 'oak', i, d, 0.8 + rnd() * 1.1, 0.75 + rnd() * 0.35);
      }
    }
    if (town) {
      if (i % 12 === 0) place('lamp', i, i % 24 === 0 ? 10.6 : -10.6, 1);
      // street trees on the verge in the suburbs
      if (!townZone(i) && i % 6 === 0) for (const side of [-1, 1]) if (rnd() < 0.55) place('oak', i, side * (13.2 + rnd() * 1.6), 0.55 + rnd() * 0.3, 0.8 + rnd() * 0.3);
      continue;
    }
    if (i % 10 === 0) { place('post', i, -7.3, 1); place('post', i, 7.3, 1); }
    if (i % 20 === 0) place('pole', i, 11.6, 1);
  }
  const color = new THREE.Color();
  for (const kind in lists) {
    const list = lists[kind];
    if (!list.length) continue;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: !FIXED.includes(kind) });
    const im = new THREE.InstancedMesh(geos[kind], mat, list.length);
    list.forEach((e, i) => { im.setMatrixAt(i, e.m); im.setColorAt(i, color.setScalar(e.tint)); });
    im.castShadow = kind !== 'post';
    im.receiveShadow = true;
    im.frustumCulled = false;
    scene.add(im);
  }
}

function gate(track, s, text, bg, fg) {
  const S = track.sample(s, {});
  const grp = new THREE.Group();
  grp.position.set(S.x, S.y, S.z);
  grp.rotation.y = S.h;
  const dark = new THREE.MeshStandardMaterial({ color: 0x22232a, roughness: 0.5, metalness: 0.6 });
  for (const x of [-8.2, 8.2]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7.6, 0.5), dark);
    pillar.position.set(x, 3.8, 0);
    pillar.castShadow = true;
    grp.add(pillar);
  }
  const tex = canvasTex(1024, 128, (g, W, H) => {
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = fg;
    for (let x = 0; x < W; x += 32) for (let y = 0; y < 2; y++) if ((x / 32 + y) % 2 === 0) { g.fillRect(x, y * 12, 32, 12); g.fillRect(x + 32, H - 24 + y * 12, 32, 12); }
    g.font = 'italic 900 78px Impact, "Arial Black", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, W / 2, H / 2 + 4);
  }, false);
  const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
  const banner = new THREE.Mesh(new THREE.BoxGeometry(16.9, 2, 0.3), [dark, dark, dark, dark, face, face]);
  banner.position.y = 6.9;
  banner.castShadow = true;
  grp.add(banner);
  const checker = canvasTex(256, 64, (g) => {
    for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#eee'; g.fillRect(x * 16, y * 16, 16, 16); }
  }, false);
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W * 2, 3.2), new THREE.MeshStandardMaterial({ map: checker, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  strip.rotation.x = -Math.PI / 2;
  strip.position.y = 0.02;
  strip.receiveShadow = true;
  grp.add(strip);
  return grp;
}

function mountains() {
  const geo = new THREE.CylinderGeometry(2600, 2600, 1, 120, 1, true);
  const p = geo.attributes.position, col = new Float32Array(p.count * 3);
  const top = new THREE.Color(0x6f7896), base = new THREE.Color(HAZE);
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const isTop = p.getY(i) > 0;
    const hgt = 170 + 120 * Math.sin(a * 3 + 1) + 80 * Math.sin(a * 7.3) + 45 * Math.sin(a * 17 + 2) + 25 * Math.sin(a * 41);
    p.setY(i, isTop ? Math.max(40, hgt) : -120);
    const c = isTop ? top : base;
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
}

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.74;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HAZE, 120, 1900);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 9000);

  // sky + image-based ambient light from it
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - SUN_ELEV), THREE.MathUtils.degToRad(SUN_AZIM));
  const sky = new Sky();
  sky.scale.setScalar(8000);
  const u = sky.material.uniforms;
  u.turbidity.value = 7; u.rayleigh.value = 1.7; u.mieCoefficient.value = 0.006; u.mieDirectionalG.value = 0.82;
  u.sunPosition.value.copy(sunDir);
  const envScene = new THREE.Scene();
  envScene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene).texture;
  scene.environmentIntensity = 0.2;
  pmrem.dispose();
  scene.add(sky);

  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x7a6a48, 1.0));
  const sun = new THREE.DirectionalLight(0xffe2b8, 4.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 10; sc.far = 420;
  sc.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);

  const far = mountains();
  const lowland = new THREE.Mesh(new THREE.CircleGeometry(4000, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6b7a3c, roughness: 1 }));
  lowland.position.y = -45;
  scene.add(far, lowland);
  let course = null;
  const dispose = (root) => root.traverse((o) => {
    o.geometry?.dispose();
    for (const mat of [].concat(o.material ?? [])) { mat.map?.dispose(); mat.dispose(); }
  });

  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  return {
    renderer, scene, camera,
    /** Build (or rebuild) everything that belongs to one course. */
    setCourse(track) {
      if (course) { scene.remove(course); dispose(course); }
      course = new THREE.Group();
      course.add(buildGround(track), buildRoad(track));
      buildScenery(track, course);
      if (track.theme === 'town') buildTown(track, course);
      course.add(gate(track, track.startS + 30, 'START', '#f2c21a', '#17171a'));
      course.add(gate(track, track.finishS, 'FINISH', '#f4f4f0', '#17171a'));
      scene.add(course);
    },
    /** Keep the shadow box and far backdrop centred on the player. */
    follow(pos) {
      sun.position.copy(pos).addScaledVector(sunDir, 200);
      sun.target.position.copy(pos);
      sky.position.set(pos.x, 0, pos.z);
      far.position.set(pos.x, 0, pos.z);
      lowland.position.set(pos.x, -45, pos.z);
    },
    render() { renderer.render(scene, camera); },
  };
}
