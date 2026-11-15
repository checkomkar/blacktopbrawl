// Arcade motorcycle physics in track space. Pure logic, no rendering imports.
import { ROAD_HALF, SHOULDER } from './track.js';

export const VMAX = 72;          // m/s (~260 km/h)
const G = 9.81;
const A_LAT = 15;                // max lateral acceleration (m/s^2)
const GEAR_TOP = [0, 16, 27, 38, 49, 60, 76];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const S = {};

export class BikeSim {
  constructor(track) {
    this.track = track;
    this.gripMul = 1;      // cornering grip multiplier (difficulty assist)
    this.power = 1;        // engine multiplier (AI rubber-banding, later: bike upgrades)
    this.vmax = VMAX;
    this.reset(track.startS, 0);
  }

  reset(s, d) {
    this.s = s;            // distance along the road
    this.d = d;            // lateral offset, + = right
    this.v = 0;            // speed (m/s)
    this.rel = 0;          // heading relative to road tangent, + = pointing right
    this.vy = 0;
    this.y = this.track.sample(s, S).y;
    this.air = false;
    this.steer = 0;        // smoothed steering -1..1
    this.lean = 0;         // roll angle, + = right
    this.gear = 1;
    this.rpm = 0.15;       // 0..1
    this.offroad = false;
    this.impact = 0;       // landing / berm impact, consumed by camera shake
    this.throttle = 0;
    this.braking = false;
    this.push = 0;         // sideways shove velocity from hits (m/s), decays
  }

  /** input: { throttle 0..1, brake 0..1, steer -1..1 (+ = right) } */
  step(dt, input) {
    const tr = this.track;
    tr.sample(this.s, S);

    this.throttle = input.throttle;
    this.braking = input.brake > 0;
    this.steer += (input.steer - this.steer) * Math.min(1, dt * 7);
    this.offroad = Math.abs(this.d) > ROAD_HALF;

    let v = this.v;
    const grip = this.air ? 0.12 : this.offroad ? 0.6 : 1;
    const yawMax = Math.min(1.5, (A_LAT * grip * this.gripMul) / Math.max(v, 6));
    const yaw = this.steer * yawMax * Math.min(1, v / 4); // rad/s, + = turning right

    // --- longitudinal
    let acc = 0;
    if (!this.air) {
      acc += input.throttle * 15 * this.power * Math.max(0, 1 - Math.pow(v / this.vmax, 2.2));
      acc -= (0.6 + 0.001 * v * v) * (input.throttle > 0 ? 0.25 : 1);
      acc -= 28 * input.brake;
      acc -= G * S.slope * 0.6;
      acc -= Math.abs(this.steer) * v * 0.02;
      if (this.offroad && v > 18) acc -= (v - 18) * 0.9 + 1;
    } else {
      acc -= 0.0006 * v * v;
    }
    v = Math.max(0, v + acc * dt);

    // --- curvilinear kinematics
    const ds = (v * Math.cos(this.rel)) / Math.max(0.3, 1 + this.d * S.k);
    this.rel += (S.k * ds + yaw) * dt;
    if (!this.air && input.steer === 0) this.rel -= this.rel * 1.2 * dt;
    this.rel = clamp(this.rel, -0.7, 0.7);
    this.d += (v * Math.sin(this.rel) + this.push) * dt;
    this.push *= Math.exp(-dt * 5);
    this.s = Math.min(tr.length - 1, this.s + ds * dt);

    // berm at the edge of the shoulder: scrubs speed and pushes the bike back
    if (Math.abs(this.d) > SHOULDER) {
      const side = Math.sign(this.d);
      this.d = side * SHOULDER;
      if (this.rel * side > 0) {
        this.impact = Math.max(this.impact, Math.abs(Math.sin(this.rel)) * v * 0.25);
        this.rel *= 0.4;
      }
      v *= Math.max(0, 1 - 1.6 * dt);
    }

    // --- vertical: ballistic whenever the road drops away faster than gravity
    tr.sample(this.s, S);
    const gy = S.y;
    const gvy = S.slope * ds;
    const vyB = this.vy - G * dt;
    const yB = this.y + vyB * dt;
    if (yB > gy) {
      this.y = yB;
      this.vy = vyB;
      this.air = yB - gy > 0.05;
    } else {
      if (this.air) {
        const hit = gvy - vyB;
        this.impact = Math.max(this.impact, hit);
        if (hit > 6) v *= 0.93;
      }
      this.y = gy;
      this.vy = gvy;
      this.air = false;
    }
    this.v = v;

    // --- presentation state
    const leanTarget = clamp(Math.atan((v * yaw) / G) * 0.95, -0.85, 0.85);
    this.lean += (leanTarget - this.lean) * Math.min(1, dt * 7);

    let g = 1;
    while (g < 6 && v > GEAR_TOP[g] * 0.97) g++;
    this.gear = g;
    const lo = GEAR_TOP[g - 1], hi = GEAR_TOP[g];
    const rpmTarget = g === 1 ? 0.15 + 0.85 * (v / hi) : 0.42 + 0.58 * ((v - lo) / (hi - lo));
    this.rpm += (clamp(rpmTarget, 0.1, 1) - this.rpm) * Math.min(1, dt * 12);
  }
}
