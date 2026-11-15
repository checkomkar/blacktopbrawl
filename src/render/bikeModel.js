import * as THREE from 'three';

// Procedural sport bike + rider. Model faces +Z, origin at the ground contact line.
// Note: the sim's "right" (d > 0) is the model's -X.
const UP = new THREE.Vector3(0, 1, 0);
const KICK_AIM = -0.5;   // leg angle at full extension; negative cancels the rider leaning away, so the boot lands at hip height
const lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));
const ease = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

/** Arm angle above horizontal through a swing: wind up, strike down, recover. */
function swingAngle(p, h) {
  if (p < h * 0.5) return lerp(0.2, 1.4, p / (h * 0.5));
  if (p < h) return lerp(1.4, -0.4, (p - h * 0.5) / (h * 0.5));
  return lerp(-0.4, 0.1, (p - h) / (1 - h));
}

/**
 * Painted helmet graphics. The canvas wraps the shell: u 0.25 is the front, 0.75 the back,
 * 0 and 0.5 the two flanks; the top of the canvas is the crown.
 */
function helmetTexture(base, accent, art) {
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const css = (n) => `#${n.toString(16).padStart(6, '0')}`;
  const ink = css(art.color ?? accent), stripe = css(art.stripe ?? accent);
  g.fillStyle = css(base);
  g.fillRect(0, 0, W, H);

  const shapes = {
    flames() {
      g.fillRect(-100, -52, 34, 104);
      [[-34, 120, 15, 8], [-10, 150, 17, -6], [16, 125, 15, 8], [40, 95, 11, -4]].forEach(([y, len, w, tip]) => {
        g.beginPath();
        g.moveTo(-70, y - w);
        g.quadraticCurveTo(-70 + len * 0.55, y - w * 1.3, -70 + len, y + tip);
        g.quadraticCurveTo(-70 + len * 0.5, y + w * 0.5, -70, y + w);
        g.fill();
      });
    },
    star() {
      const star = (cx, cy, r) => {
        g.beginPath();
        for (let k = 0; k < 10; k++) {
          const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r * 0.42 : r;
          g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        }
        g.fill();
      };
      star(0, 0, 40); star(62, -26, 15); star(70, 24, 11); star(-60, 30, 13);
    },
    checker() {
      for (let x = -4; x < 4; x++) for (let y = -2; y < 2; y++) if ((x + y) & 1) g.fillRect(x * 22, y * 22, 22, 22);
    },
    bolt() {
      g.beginPath();
      [[-78, -40], [6, -12], [-16, 2], [82, 38], [-2, 16], [18, 2]].forEach(([x, y]) => g.lineTo(x, y));
      g.fill();
    },
    stripes() {
      for (let k = 0; k < 3; k++) {
        const x = -70 + k * 46;
        g.beginPath();
        g.moveTo(x, 46); g.lineTo(x + 30, -46); g.lineTo(x + 54, -46); g.lineTo(x + 24, 46);
        g.fill();
      }
    },
    argyle() {
      for (let k = -2; k <= 2; k++) {
        g.beginPath();
        g.moveTo(k * 38, -44); g.lineTo(k * 38 + 19, 0); g.lineTo(k * 38, 44); g.lineTo(k * 38 - 19, 0);
        g.fill();
      }
      g.strokeStyle = stripe; g.lineWidth = 2;
      for (let k = -3; k <= 2; k++) {
        g.beginPath(); g.moveTo(k * 38, -44); g.lineTo(k * 38 + 38, 44); g.moveTo(k * 38 + 38, -44); g.lineTo(k * 38, 44); g.stroke();
      }
    },
  };
  // flank art, mirrored so it always trails toward the back of the helmet
  const flank = (cx, dir) => {
    g.save();
    g.translate(cx, H * 0.57);
    g.scale(dir, 1);
    g.fillStyle = ink;
    (shapes[art.style] ?? shapes.stripes)();
    g.restore();
  };
  flank(W * 0.5, 1); flank(0, -1); flank(W, -1);

  // racing stripe over the crown (front and back seams) with pinstripes, plus a base trim line
  for (const u of [0.25, 0.75]) {
    g.fillStyle = stripe;
    g.fillRect(W * u - 17, 0, 34, H);
    g.fillStyle = '#15151a';
    g.fillRect(W * u - 23, 0, 3, H);
    g.fillRect(W * u + 20, 0, 3, H);
  }
  g.fillStyle = stripe;
  g.fillRect(0, H * 0.87, W, 7);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function createBike({ color = 0xd3202c, suit = 0x1d1e24, accent = 0xf2c21a, helmet = 0xf1f1ee, headScale = 1, helmetArt = {} } = {}) {
  const root = new THREE.Group();          // world position, yaw, pitch
  root.rotation.order = 'YXZ';
  const tilt = new THREE.Group();          // roll about the tyre contact line
  root.add(tilt);

  const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.1, ...o });
  const paintM = M(color, { roughness: 0.22, metalness: 0.35 });
  const dark = M(0x16161b, { roughness: 0.7 });
  const metal = M(0xc0c4cc, { roughness: 0.22, metalness: 0.95 });
  const tyre = M(0x0d0d0e, { roughness: 0.92 });
  const suitM = M(suit, { roughness: 0.6 });
  const accentM = M(accent, { roughness: 0.5 });
  const helmetM = M(helmet, { roughness: 0.18, metalness: 0.25 });
  const visorM = M(0x090b10, { roughness: 0.05, metalness: 0.8 });
  const woodM = M(0xc89b5a, { roughness: 0.6 });

  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = tilt) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const limb = (a, b, r, mat, parent) => {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r * 0.6), 4, 10), mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(UP, vb.sub(va).normalize());
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  // --- wheels
  const R = 0.325;
  const wheel = (z) => {
    const g = new THREE.Group();
    g.position.set(0, R, z);
    add(new THREE.TorusGeometry(0.25, 0.078, 12, 28), tyre, 0, 0, 0, 0, Math.PI / 2, 0, g);
    add(new THREE.CylinderGeometry(0.185, 0.185, 0.06, 20), metal, 0, 0, 0, 0, 0, Math.PI / 2, g);
    for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.075, 0.36, 0.04), dark, 0, 0, 0, (i * Math.PI) / 3, 0, 0, g);
    add(new THREE.CylinderGeometry(0.13, 0.13, 0.012, 20), M(0x777b84, { metalness: 0.9, roughness: 0.3 }), 0.06, 0, 0, 0, 0, Math.PI / 2, g);
    tilt.add(g);
    return g;
  };
  const rear = wheel(-0.68), front = wheel(0.72);

  // --- chassis
  add(new THREE.BoxGeometry(0.28, 0.34, 0.5), dark, 0, 0.5, 0.0);                       // engine
  add(new THREE.BoxGeometry(0.33, 0.24, 0.78), paintM, 0, 0.4, 0.14, -0.12);            // belly fairing
  add(new THREE.SphereGeometry(0.2, 18, 12).scale(1, 0.78, 1.65), paintM, 0, 0.84, 0.1); // tank
  add(new THREE.BoxGeometry(0.25, 0.08, 0.46), dark, 0, 0.8, -0.34);                     // seat
  add(new THREE.BoxGeometry(0.2, 0.11, 0.42), paintM, 0, 0.87, -0.62, 0.28);             // tail
  add(new THREE.SphereGeometry(0.21, 16, 12).scale(0.95, 0.85, 1.1), paintM, 0, 0.88, 0.5); // nose
  add(new THREE.BoxGeometry(0.27, 0.2, 0.02), M(0x0b0e14, { roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.75 }), 0, 1.06, 0.5, -0.95); // screen
  add(new THREE.BoxGeometry(0.2, 0.07, 0.03), M(0xfff6d8, { emissive: 0xfff0c0, emissiveIntensity: 1.5 }), 0, 0.86, 0.725); // headlight
  const tailMat = M(0xff2a1a, { emissive: 0xff1a0a, emissiveIntensity: 0.6 });
  add(new THREE.BoxGeometry(0.15, 0.05, 0.03), tailMat, 0, 0.93, -0.83);
  for (const x of [-0.09, 0.09]) {
    add(new THREE.CylinderGeometry(0.026, 0.026, 0.66, 8), metal, x, 0.62, 0.61, -0.37);   // fork
    add(new THREE.BoxGeometry(0.045, 0.06, 0.62), metal, x * 1.1, 0.36, -0.38, 0.06);      // swingarm
  }
  add(new THREE.BoxGeometry(0.2, 0.03, 0.34), dark, 0, 0.68, 0.74, -0.25);                 // front fender
  add(new THREE.CylinderGeometry(0.018, 0.018, 0.62, 8), dark, 0, 0.99, 0.44, 0, 0, Math.PI / 2); // bars
  add(new THREE.CylinderGeometry(0.05, 0.065, 0.52, 12), metal, -0.17, 0.55, -0.56, Math.PI / 2 - 0.3); // exhaust

  // --- rider (tucked)
  const rider = new THREE.Group();
  tilt.add(rider);
  limb([0, 0.96, -0.3], [0, 1.3, 0.12], 0.155, suitM, rider);                 // torso
  add(new THREE.BoxGeometry(0.24, 0.3, 0.03), accentM, 0, 1.2, -0.19, 0.89, 0, 0, rider); // back stripe

  // full-face race helmet: painted shell, rounded chin piece, wraparound visor, rear spoiler
  const hr = 0.135 * headScale;
  const head = new THREE.Group();
  head.position.set(0, 1.44 + (headScale - 1) * 0.1, 0.2);
  head.rotation.x = 0.22;
  rider.add(head);
  const shellM = new THREE.MeshStandardMaterial({ map: helmetTexture(helmet, accent, helmetArt), roughness: 0.16, metalness: 0.25 });
  const trimM = M(helmetArt.stripe ?? accent, { roughness: 0.2, metalness: 0.25 });
  add(new THREE.SphereGeometry(hr, 28, 20).scale(0.96, 1, 1.2), shellM, 0, 0, 0, 0, 0, 0, head);
  add(new THREE.SphereGeometry(hr * 0.8, 20, 14).scale(1.02, 0.72, 1.05), helmetM, 0, -hr * 0.42, hr * 0.5, 0, 0, 0, head);      // chin piece
  add(new THREE.BoxGeometry(hr * 0.7, hr * 0.07, hr * 0.06), dark, 0, -hr * 0.5, hr * 1.33, 0, 0, 0, head);                       // breath vent
  add(new THREE.SphereGeometry(hr * 1.04, 26, 8, Math.PI / 2 - 1.2, 2.4, Math.PI * 0.35, Math.PI * 0.2).scale(0.96, 1, 1.2), visorM, 0, 0, 0, 0, 0, 0, head);
  for (const sx of [-1, 1]) add(new THREE.CylinderGeometry(hr * 0.13, hr * 0.13, hr * 0.06, 10), trimM, sx * hr * 0.95, -hr * 0.05, hr * 0.12, 0, 0, Math.PI / 2, head); // visor pivots
  add(new THREE.BoxGeometry(hr * 0.9, hr * 0.06, hr * 0.5), trimM, 0, hr * 0.42, -hr * 1.02, -0.5, 0, 0, head);                   // rear spoiler
  add(new THREE.CylinderGeometry(hr * 0.6, hr * 0.68, hr * 0.45, 14), dark, 0, -hr * 0.98, -hr * 0.08, 0, 0, 0, head);            // neck roll

  // limbs per side, plus a hidden striking arm and kicking leg that take over during attacks
  const sides = {};
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group(), leg = new THREE.Group();
    rider.add(arm, leg);
    limb([sx * 0.2, 1.27, 0.1], [sx * 0.29, 1.1, 0.3], 0.055, suitM, arm);   // upper arm
    limb([sx * 0.29, 1.1, 0.3], [sx * 0.27, 1.0, 0.45], 0.048, suitM, arm);  // forearm
    limb([sx * 0.12, 0.92, -0.3], [sx * 0.2, 0.74, 0.1], 0.08, suitM, leg);  // thigh
    limb([sx * 0.2, 0.74, 0.1], [sx * 0.19, 0.4, -0.2], 0.06, suitM, leg);   // shin
    add(new THREE.BoxGeometry(0.09, 0.08, 0.24), dark, sx * 0.19, 0.36, -0.16, 0, 0, 0, leg); // boot

    // striking arm: shoulder -> elbow -> glove, weapon held in the fist
    const strike = new THREE.Group();
    strike.position.set(sx * 0.2, 1.27, 0.1);
    strike.visible = false;
    rider.add(strike);
    limb([0, 0, 0], [sx * 0.32, 0, 0], 0.06, suitM, strike);
    const elbow = new THREE.Group();
    elbow.position.set(sx * 0.32, 0, 0);
    strike.add(elbow);
    limb([0, 0, 0], [sx * 0.3, 0, 0], 0.052, suitM, elbow);
    add(new THREE.SphereGeometry(0.095, 12, 10), dark, sx * 0.34, 0, 0, 0, 0, 0, elbow);      // big glove
    const grip = new THREE.Group();
    grip.position.set(sx * 0.34, 0, 0);
    elbow.add(grip);
    const bat = add(new THREE.CylinderGeometry(0.06, 0.032, 0.95, 10), woodM, sx * 0.38, 0, 0, 0, 0, -sx * Math.PI / 2, grip);
    // chain: nested links that curl and straighten, so it cracks like a whip
    const chain = new THREE.Group();
    grip.add(chain);
    const links = [];
    let parent = chain;
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.Group();
      seg.position.set(i ? sx * 0.25 : 0, 0, 0);
      parent.add(seg);
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.25, 6), metal, sx * 0.125, 0, 0, 0, 0, Math.PI / 2, seg);
      add(new THREE.TorusGeometry(0.052, 0.017, 5, 10), metal, sx * 0.125, 0, 0, i % 2 ? Math.PI / 2 : 0, Math.PI / 2, 0, seg);
      links.push(seg);
      parent = seg;
    }
    add(new THREE.SphereGeometry(0.09, 8, 6), metal, sx * 0.28, 0, 0, 0, 0, 0, parent);

    // kicking leg: hip -> knee -> boot, sole toward the target
    const kick = new THREE.Group();
    kick.position.set(sx * 0.12, 0.92, -0.2);
    kick.visible = false;
    rider.add(kick);
    limb([0, 0, 0], [sx * 0.44, 0, 0], 0.085, suitM, kick);
    const knee = new THREE.Group();
    knee.position.set(sx * 0.44, 0, 0);
    kick.add(knee);
    limb([0, 0, 0], [sx * 0.42, 0, 0], 0.07, suitM, knee);
    add(new THREE.BoxGeometry(0.13, 0.36, 0.17), dark, sx * 0.47, 0.07, 0, 0, 0, 0, knee);    // boot, toes up
    add(new THREE.BoxGeometry(0.03, 0.36, 0.17), accentM, sx * 0.55, 0.07, 0, 0, 0, 0, knee); // sole
    sides[sx] = { arm, leg, strike, elbow, grip, bat, chain, links, kick, knee };
  }

  // carried weapons, shown when not mid-swing
  const backBat = add(new THREE.CylinderGeometry(0.05, 0.03, 0.85, 10), woodM, 0.05, 1.22, -0.26, 0.9, 0, 0.5, rider);
  const backChain = add(new THREE.TorusGeometry(0.2, 0.025, 6, 18), metal, 0, 1.14, -0.12, 0.9, 0, 0.6, rider);

  const state = { roll: 0, jolt: 0 };

  return {
    root, tilt, rider, pitch: 0, spin: 0,
    /** Knock the rider sideways for a moment (side: +1 = toward sim right). */
    jolt(side) { state.jolt = side * 0.55; },
    /** Apply sim state to the model. `f` is the race entrant (attack, crash, carry). */
    update(bike, dt, f) {
      const spin = (bike.v / R) * dt;
      front.rotation.x += spin;
      rear.rotation.x += spin;

      const down = f.crash > 0;
      state.roll += ((down ? 1.45 : 0) - state.roll) * Math.min(1, dt * 9);
      state.jolt *= Math.exp(-dt * 7);
      this.spin = down ? this.spin + dt * bike.v * 0.22 : 0;
      tailMat.emissiveIntensity = bike.braking ? 4 : 0.6;

      // Angles below are "raise above horizontal" for a limb pointing out to the side;
      // multiplying by sx mirrors them for the left/right limb.
      const a = f.attack;
      let bodyLean = 0;            // + = torso tips toward model -x
      for (const sx of [-1, 1]) {
        const s = sides[sx];
        const active = a && -a.side === sx;
        const isKick = !!active && a.kind === 'kick';
        const isArm = !!active && !isKick;
        s.arm.visible = !isArm;
        s.strike.visible = isArm;
        s.leg.visible = !isKick;
        s.kick.visible = isKick;
        if (!active) continue;
        const p = a.t / a.w.dur, h = a.w.hitAt;

        if (isKick) {
          // chamber the knee up, snap the boot out sideways, hold, pull back
          let thigh, shin, ext;
          if (p < h * 0.5) { const c = ease(p / (h * 0.5)); thigh = lerp(-0.6, 0.35, c); shin = lerp(-1.5, -2.1, c); ext = 0; }
          else if (p < h) { const e = ease((p - h * 0.5) / (h * 0.5)); thigh = lerp(0.35, KICK_AIM, e); shin = lerp(-2.1, 0, e); ext = e; }
          else if (p < h + 0.2) { thigh = KICK_AIM; shin = 0; ext = 1; }
          else { const r = ease((p - h - 0.2) / (1 - h - 0.2)); thigh = lerp(KICK_AIM, -0.6, r); shin = lerp(0, -1.5, r); ext = 1 - r; }
          s.kick.rotation.z = sx * thigh;
          s.knee.rotation.z = sx * shin;
          bodyLean = sx * 0.32 * ext;                 // lean away to counterbalance
          continue;
        }

        let raise, bend, sweep, gripTilt = 0.15, ext = 0;
        if (a.kind === 'fist') {
          // jab: fist cocked by the helmet, then driven straight out
          if (p < h * 0.45) { const c = ease(p / (h * 0.45)); raise = lerp(-0.8, -0.45, c); bend = lerp(1.5, 2.35, c); }
          else if (p < h) { ext = ease((p - h * 0.45) / (h * 0.55)); raise = lerp(-0.45, 0.05, ext); bend = lerp(2.35, 0, ext); }
          else if (p < h + 0.18) { raise = 0.05; bend = 0; ext = 1; }
          else { const r = ease((p - h - 0.18) / (1 - h - 0.18)); raise = lerp(0.05, -0.8, r); bend = lerp(0, 1.5, r); ext = 1 - r; }
          sweep = 0.15;
          bodyLean = -sx * 0.22 * ext;                // throw the shoulder into it
        } else if (a.kind === 'bat') {
          raise = swingAngle(p, h);
          bend = 0.25;
          sweep = lerp(-0.5, 0.35, p / h);
          gripTilt = 0.7;
          bodyLean = -sx * 0.1;
        } else {
          // chain: whirl it up overhead, then lash down and out; the links lag behind the arm
          raise = p < h * 0.5 ? lerp(0.4, 1.5, ease(p / (h * 0.5))) : p < h ? lerp(1.5, -0.25, ease((p - h * 0.5) / (h * 0.5))) : lerp(-0.25, 0.1, (p - h) / (1 - h));
          bend = 0.2;
          sweep = lerp(-0.6, 0.3, p / h);
          const curl = p < h * 0.7 ? lerp(0.15, 0.55, p / (h * 0.7)) : p < h * 1.2 ? lerp(0.55, -0.12, (p - h * 0.7) / (h * 0.5)) : lerp(-0.12, 0.05, (p - h * 1.2) / (1 - h * 1.2));
          for (const seg of s.links) seg.rotation.z = sx * curl;
          bodyLean = -sx * 0.1;
        }
        s.strike.rotation.z = sx * raise;
        s.strike.rotation.y = -sx * sweep;            // sweeps from behind to ahead
        s.elbow.rotation.z = sx * bend;
        s.grip.rotation.z = sx * gripTilt;
        s.bat.visible = a.kind === 'bat';
        s.chain.visible = a.kind === 'chain';
      }

      tilt.rotation.z = bike.lean + state.roll;
      rider.rotation.z = bike.lean * 0.18 + state.jolt + bodyLean;
      rider.position.x = -bike.lean * 0.1;
      rider.position.y = down ? 0.05 : 0;
      backBat.visible = f.carry.includes('bat') && !(a && a.kind === 'bat');
      backChain.visible = f.carry.includes('chain') && !(a && a.kind === 'chain');
    },
  };
}
