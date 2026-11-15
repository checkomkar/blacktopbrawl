// Pure track data + queries. No rendering imports (keeps the sim portable).

export const STEP = 3;          // metres between centreline samples
export const ROAD_HALF = 6;     // paved half-width
export const SHOULDER = 9.5;    // rideable limit (gravel shoulder ends in a berm)

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (t) => {
  t = Math.min(1, Math.max(0, t));
  return t * t * (3 - 2 * t);
};

// Height of the terrain relative to the road at lateral offset d (world x,z for noise).
export function terrainLift(d, x, z, flat = 13) {
  const a = Math.abs(d);
  if (a <= flat) return 0;
  const t = smooth((a - flat) / 110);
  const n =
    Math.sin(x * 0.011 + 1.3) * Math.cos(z * 0.013) +
    0.5 * Math.sin(x * 0.031 + z * 0.027);
  return t * (7 + 14 * n) + t * t * 12;
}

/**
 * Conventions: heading h gives forward = (sin h, 0, cos h); right = (-cos h, 0, sin h).
 * Curvature k > 0 turns left. Lateral offset d > 0 is to the right of the centreline.
 */
export function buildTrack({ seed = 11, length = 6400, hills = 1, flat = 13, theme = 'country' } = {}) {
  const rnd = mulberry32(seed);
  const n = Math.floor(length / STEP) + 1;
  let k = new Float32Array(n);

  // --- curvature sections (heading kept within ~±66° so the road never doubles back)
  const first = Math.floor(280 / STEP);
  const last = n - Math.floor(420 / STEP);
  let i = first;
  let heading = 0;
  while (i < last) {
    if (rnd() < 0.28) {
      i += Math.floor((80 + rnd() * 220) / STEP);
      continue;
    }
    const R = 170 + rnd() * rnd() * 520;
    const len = Math.min(140 + rnd() * 320, 1.1 * R);
    const cnt = Math.min(Math.floor(len / STEP), last - i);
    const dh = (cnt * STEP) / R;
    let sign = rnd() < 0.5 ? -1 : 1;
    if (Math.abs(heading + sign * dh) > 1.15) sign = -sign;
    for (let j = 0; j < cnt; j++) k[i + j] = sign / R;
    heading += sign * dh;
    i += cnt + Math.floor((20 + rnd() * 70) / STEP);
  }
  // ease curves in/out: two box-blur passes (~36 m window)
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float32Array(n);
    const w = 6;
    for (let a = 0; a < n; a++) {
      let sum = 0;
      for (let b = -w; b <= w; b++) sum += k[Math.min(n - 1, Math.max(0, a + b))];
      out[a] = sum / (2 * w + 1);
    }
    k = out;
  }

  // --- elevation: rolling hills + a few sharp crests that launch the bike
  const p1 = rnd() * 6.28, p2 = rnd() * 6.28, p3 = rnd() * 6.28;
  const jumps = [];
  for (let j = 0; j < 6; j++) jumps.push(700 + ((length - 1500) * (j + rnd() * 0.7)) / 6);
  const elev = (s) => {
    const env = smooth((s - 150) / 400) * smooth((length - 330 - s) / 400);
    let y = (14 * Math.sin(s / 210 + p1) + 7 * Math.sin(s / 83 + p2) + 1.5 * Math.sin(s / 45 + p3)) * hills;
    for (const js of jumps) {
      const u = (s - js) / 11;
      if (u > -4 && u < 4) y += 1.6 * Math.exp(-u * u);
    }
    return y * env;
  };

  const px = new Float32Array(n), py = new Float32Array(n), pz = new Float32Array(n);
  const h = new Float32Array(n), slope = new Float32Array(n);
  let x = 0, z = 0, hd = 0;
  for (let a = 0; a < n; a++) {
    h[a] = hd; px[a] = x; pz[a] = z; py[a] = elev(a * STEP);
    x += Math.sin(hd) * STEP;
    z += Math.cos(hd) * STEP;
    hd += k[a] * STEP;
  }
  for (let a = 0; a < n; a++) {
    const a0 = Math.max(0, a - 1), a1 = Math.min(n - 1, a + 1);
    slope[a] = (py[a1] - py[a0]) / ((a1 - a0) * STEP);
  }

  const track = {
    n, length: (n - 1) * STEP, px, py, pz, h, k, slope, jumps, flat, theme,
    startS: 60,
    finishS: (n - 1) * STEP - 300,
    /** Interpolated centreline sample at distance s. Writes into `out`. */
    sample(s, out) {
      const f = Math.min(n - 1.001, Math.max(0, s / STEP));
      const a = f | 0, t = f - a, b = a + 1;
      out.x = px[a] + (px[b] - px[a]) * t;
      out.y = py[a] + (py[b] - py[a]) * t;
      out.z = pz[a] + (pz[b] - pz[a]) * t;
      out.h = h[a] + (h[b] - h[a]) * t;
      out.k = k[a] + (k[b] - k[a]) * t;
      out.slope = slope[a] + (slope[b] - slope[a]) * t;
      return out;
    },
  };
  return track;
}
