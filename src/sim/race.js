// Race state: the player plus AI rivals, grid, contacts, combat, standings. Pure logic.
import { BikeSim, VMAX } from './bike.js';
import { CAST, PLAYER, COP } from './cast.js';
import { MAX_COPS } from './courses.js';
import { mulberry32 } from './track.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const S = {}, S2 = {};
const DOWN_INPUT = { throttle: 0, brake: 1, steer: 0 };

/** reach = sideways gap covered (m); push = shove speed (m/s); hitAt = fraction of dur when it lands */
export const WEAPONS = {
  fist: { name: 'PUNCH', reach: 1.5, dmg: 10, push: 2.5, dur: 0.36, hitAt: 0.5 },
  bat: { name: 'BAT', reach: 2.0, dmg: 28, push: 5, dur: 0.55, hitAt: 0.55 },
  chain: { name: 'CHAIN', reach: 2.8, dmg: 20, push: 4, dur: 0.6, hitAt: 0.6 },
  kick: { name: 'KICK', reach: 1.7, dmg: 8, push: 10, dur: 0.56, hitAt: 0.45 },
};

/**
 * speed/corner scale the rivals; band/vband/range shape the rubber band (how hard rivals ease off
 * when ahead of the player); lead makes them start easing off before they are level; cooldown stretches the gap between their attacks; dmgIn/dmgOut scale
 * damage the player takes/deals; grip/power assist the player's own bike. copSpeed scales police top speed,
 * chase is how long (s) a cop keeps after the player, bust how long (s) a cop must hold a stopped player.
 */
export const DIFFICULTY = {
  easy: { label: 'EASY', speed: 1, corner: 0.95, band: [0.45, 1.25], vband: [0.5, 1.12], range: 150, lead: 10, pace: true, cooldown: 2.2, dmgIn: 0.5, dmgOut: 1.5, grip: 1.3, power: 1.12, copSpeed: 0.96, chase: 18, bust: 1.6 },
  normal: { label: 'NORMAL', speed: 0.94, corner: 0.9, band: [0.68, 1.1], vband: [0.86, 1.04], range: 380, lead: 0, cooldown: 1.4, dmgIn: 0.8, dmgOut: 1.15, grip: 1.12, power: 1.04, copSpeed: 1, chase: 28, bust: 1 },
  hard: { label: 'HARD', speed: 1, corner: 1, band: [0.78, 1.18], vband: [0.9, 1.07], range: 500, lead: 0, cooldown: 1, dmgIn: 1, dmgOut: 1, grip: 1, power: 1, copSpeed: 1.04, chase: 40, bust: 0.6 },
};
const REACH_S = 1.9;        // how far ahead/behind a strike can land
const WIPEOUT_TIME = 3;

export class Race {
  constructor(track) {
    this.track = track;
    this.player = { who: PLAYER, bike: new BikeSim(track), isPlayer: true };
    this.rivals = CAST.map((who) => ({ who, bike: new BikeSim(track), input: { throttle: 0, brake: 1, steer: 0 } }));
    this.entrants = [this.player, ...this.rivals];
    // police: parked at posts along the course, give chase when the player rides past
    this.cops = Array.from({ length: MAX_COPS }, () => ({ who: COP, bike: new BikeSim(track), isCop: true, state: 'off', input: { throttle: 0, brake: 1, steer: 0 } }));
    this.riders = [...this.entrants, ...this.cops];
    this.posts = [];
    this.events = [];       // drained by the presentation layer: hit / miss / wipeout / police / busted
    this.difficulty = 'easy';
    this.reset();
  }

  /** Swap to another course. posts = fractions of the race distance where police wait. */
  setCourse(track, posts = []) {
    this.track = track;
    for (const e of this.riders) e.bike.track = track;
    this.posts = posts.map((f) => track.startS + f * (track.finishS - track.startS));
    this.reset();
  }

  /** True for anyone who can't touch or be touched right now. */
  out(e) { return e.crash > 0 || (e.isCop && e.state !== 'chase'); }

  /** Grid: player at the back, slowest rival just ahead, fastest on pole. */
  reset() {
    const t = this.track;
    this.rnd = mulberry32(1234);
    this.time = 0;
    this.pace = 0;
    this.finished = [];
    this.events.length = 0;
    const D = this.D = DIFFICULTY[this.difficulty];
    this.player.bike.reset(t.startS, -2.2);
    this.player.bike.gripMul = D.grip;
    this.player.bike.power = D.power;
    const order = [...this.rivals].sort((a, b) => a.who.skill - b.who.skill);
    order.forEach((r, j) => {
      r.bike.reset(t.startS + 4.5 * (j + 1), j % 2 === 0 ? 2.2 : -2.2);
      r.lane = r.bike.d;
      r.laneTimer = 2 + this.rnd() * 3;
      r.cooldown = 4 + this.rnd() * 3;
      r.brawlT = 0;
      r.brawlRest = 0;
      r.sticky = false;
    });
    this.busted = false;
    this.player.busted = false;
    this.cops.forEach((c, j) => {
      const on = j < this.posts.length;
      c.state = on ? 'parked' : 'off';
      c.side = j % 2 ? -1 : 1;
      c.bike.reset(on ? this.posts[j] : t.startS, c.side * 8.4);
      c.timer = 0; c.cooldown = 0; c.bustT = 0;
    });
    for (const e of this.riders) {
      e.finishTime = null;
      e.health = 100;
      e.crash = 0;          // seconds left lying on the road
      e.attack = null;      // { kind, side, t, w, hit }
      e.sinceHit = 99;
      e.weapon = e.isPlayer ? null : e.who.weapon;            // what the AI swings with
      e.carry = e.isPlayer ? ['bat', 'chain'] : [e.who.weapon]; // what is shown on the rider
    }
  }

  step(dt, playerInput, racing) {
    if (racing) this.time += dt;
    this.player.bike.step(dt, this.player.crash > 0 || this.busted ? DOWN_INPUT : playerInput);
    this.pace += (this.player.bike.v - this.pace) * Math.min(1, dt * 0.6);   // smoothed player speed
    for (const r of this.rivals) {
      this.think(r, dt, racing);
      r.bike.step(dt, r.input);
    }
    for (const c of this.cops) {
      if (c.state === 'off') continue;
      this.thinkCop(c, dt, racing);
      c.bike.step(dt, c.input);
    }
    this.contacts();
    this.combat(dt);
    if (!racing) return;
    for (const e of this.entrants) {
      if (e.finishTime === null && e.bike.s >= this.track.finishS) {
        e.finishTime = this.time;
        this.finished.push(e);
      }
    }
  }

  // ------------------------------------------------------------------ AI
  think(r, dt, racing) {
    const b = r.bike, t = this.track, sk = r.who.skill, inp = r.input;
    if (!racing || r.finishTime !== null || r.crash > 0) {
      inp.throttle = 0;
      inp.brake = racing && r.crash <= 0 ? 0.6 : 1;
      inp.steer = r.crash > 0 ? 0 : clamp(-b.rel * 3, -1, 1);
      return;
    }
    // rubber band: ease off when far ahead of the player, push when behind
    const p = this.player;
    const gap = b.s - p.bike.s;
    const D = this.D;
    b.power = (0.8 + 0.22 * sk) * D.speed * clamp(1 - (gap + D.lead) / D.range, D.band[0], D.band[1]);
    b.vmax = VMAX * (0.87 + 0.11 * sk) * D.speed * clamp(1 - (gap + D.lead) / (D.range * 1.8), D.vband[0], D.vband[1]);

    // lane choice
    r.laneTimer -= dt;
    if (r.laneTimer <= 0) {
      r.laneTimer = 3 + this.rnd() * 5;
      r.lane = (this.rnd() * 2 - 1) * 4.2;
    }
    let lane = r.lane;

    // brawling: aggressive riders pull alongside the player and swing
    r.cooldown -= dt;
    if (p.crash <= 0 && p.finishTime === null) {
      const dd = p.bike.d - b.d;
      // stick with the player for a few seconds of brawling, then break away for a while
      r.brawlRest = Math.max(0, (r.brawlRest ?? 0) - dt);
      const sticky = Math.abs(gap) < 7 && r.who.aggro > 0.4 && r.brawlRest <= 0;
      if (sticky) {
        lane = p.bike.d + (dd > 0 ? -1.5 : 1.5);
        r.brawlT = (r.brawlT ?? 0) + dt;
        if (r.brawlT > 4 + 4 * r.who.aggro) { r.brawlT = 0; r.brawlRest = 9; }
      }
      r.sticky = sticky;
      if (r.cooldown <= 0 && Math.abs(gap) < 1.6 && Math.abs(dd) > 0.3 && Math.abs(dd) < WEAPONS[r.weapon].reach) {
        this.startAttack(r, this.rnd() < 0.25 ? 'kick' : r.weapon);
        r.cooldown = ((1.2 + this.rnd() * 2) / (0.5 + r.who.aggro)) * D.cooldown;
      }
    }
    // dodge slower traffic directly ahead
    for (const o of this.entrants) {
      if (o === r) continue;
      const ds = o.bike.s - b.s;
      if (ds > 0 && ds < 16 && Math.abs(o.bike.d - b.d) < 1.4 && o.bike.v < b.v + 1) {
        lane = o.bike.d + (b.d >= o.bike.d ? 2.3 : -2.3);
      }
    }
    lane = clamp(lane, -5, 5);

    t.sample(b.s + b.v * 0.5, S);
    t.sample(b.s + b.v * 1.3, S2);
    inp.steer = clamp((-(b.d - lane) * 0.07 - b.rel * 2.2 - S.k * b.v * 1.2) * 3, -1, 1);
    const k = Math.max(Math.abs(S.k), Math.abs(S2.k), 1e-4);
    // riders who have dropped behind the player corner harder so the pack stays together
    const catchUp = clamp(-gap / 80, 0, 1);
    b.gripMul = 1 + 0.35 * catchUp;
    const vSafe = Math.sqrt(((8.5 + 4.5 * sk) * D.corner * (1 + 0.4 * catchUp)) / k);
    inp.throttle = b.v < vSafe ? 1 : 0;
    inp.brake = b.v > vSafe + 3 ? 1 : 0;
    // Easy: rivals ride at the player's own pace - a touch slower when level so the player
    // can work past them, faster when behind so there is always someone to fight
    if (D.pace) {
      const cap = Math.max(24, this.pace) * clamp(0.975 - gap / 150, 0.65, 1.3);
      if (b.v > cap) { inp.throttle = 0; if (b.v > cap + 6) inp.brake = Math.max(inp.brake, 0.4); }
    }
    // while brawling, hold station beside the player instead of pulling away
    if (r.sticky && gap > 0.5 && b.v > p.bike.v - 1) inp.throttle = 0;
  }

  // ------------------------------------------------------------------ police
  thinkCop(c, dt, racing) {
    const b = c.bike, p = this.player, inp = c.input, D = this.D, t = this.track;
    inp.throttle = 0; inp.brake = 1; inp.steer = clamp(-b.rel * 3, -1, 1);
    if (c.state === 'down') return;
    const gap = b.s - p.bike.s;
    if (c.state === 'parked') {
      // pull out as the player approaches, so the cop is rolling when they arrive
      if (racing && !this.busted && p.finishTime === null && gap < Math.max(120, p.bike.v * 3) && gap > -20 && p.bike.v > 12) {
        c.state = 'chase'; c.timer = D.chase; c.cooldown = 1.5; c.bustT = 0;
        this.events.push({ type: 'police', on: true, cop: c });
      }
      return;
    }
    if (c.state === 'quit') {        // pull over onto the shoulder
      inp.steer = clamp((-(b.d - c.side * 8.4) * 0.07 - b.rel * 2.2) * 3, -1, 1);
      inp.brake = 0.5;
      return;
    }
    c.timer -= dt;
    if (c.timer <= 0 || gap < -500 || p.finishTime !== null || this.busted) {
      c.state = 'quit';
      if (!this.busted && p.finishTime === null) this.events.push({ type: 'police', on: false, cop: c });
      return;
    }
    b.gripMul = 1.3;
    b.power = 1.3 + clamp(-gap / 60, 0, 0.7);
    b.vmax = VMAX * (D.copSpeed + clamp((-gap - 10) / 120, 0, 0.4));   // sprint when dropped
    // ride alongside the player, on the side with more road
    const dd = p.bike.d - b.d;
    const side = Math.abs(p.bike.d) > 3.5 ? -Math.sign(p.bike.d) : (dd > 0 ? -1 : 1);
    const lane = clamp(p.bike.d + side * 1.5, -5.5, 5.5);
    t.sample(b.s + b.v * 0.5, S);
    t.sample(b.s + b.v * 1.3, S2);
    inp.steer = clamp((-(b.d - lane) * 0.07 - b.rel * 2.2 - S.k * b.v * 1.2) * 3, -1, 1);
    const k = Math.max(Math.abs(S.k), Math.abs(S2.k), 1e-4);
    let want = Math.sqrt(18 / k);
    if (gap > -4) want = Math.min(want, p.bike.v - clamp(gap * 0.5, -3, 0.6 * p.bike.v));   // wait for / hold station beside the player
    inp.throttle = b.v < want ? 1 : 0;
    inp.brake = b.v > want + 2 ? (b.v > want + 4 ? 1 : 0.4) : 0;

    c.cooldown -= dt;
    if (c.cooldown <= 0 && p.crash <= 0 && Math.abs(gap) < 1.6 && Math.abs(dd) > 0.3 && Math.abs(dd) < WEAPONS.bat.reach) {
      this.startAttack(c, 'bat');
      c.cooldown = (2.2 + this.rnd() * 2) * D.cooldown;
    }
    // busted: stopped (or lying on the road) with a cop standing over you
    const slow = p.bike.v < 7 || (p.crash > 0 && p.bike.v < 18);
    c.bustT = racing && slow && Math.abs(gap) < 16 ? c.bustT + dt : 0;
    if (c.bustT > D.bust) {
      this.busted = true;
      p.busted = true;
      p.attack = null;
      this.events.push({ type: 'busted', cop: c });
    }
  }

  /** Bikes can't pass through each other: shove apart sideways, no free ramming from behind. */
  contacts() {
    const es = this.riders;
    for (let i = 0; i < es.length; i++) {
      for (let j = i + 1; j < es.length; j++) {
        if (this.out(es[i]) || this.out(es[j])) continue;
        const a = es[i].bike, b = es[j].bike;
        const ds = a.s - b.s, dd = a.d - b.d;
        if (Math.abs(ds) > 1.7 || Math.abs(dd) > 0.8) continue;
        const push = ((0.8 - Math.abs(dd)) / 2) * (dd >= 0 ? 1 : -1);
        a.d += push;
        b.d -= push;
        if (Math.abs(dd) < 0.45) {
          const front = ds > 0 ? a : b, rear = ds > 0 ? b : a;
          if (rear.v > front.v) rear.v = front.v;
        }
      }
    }
  }

  // ------------------------------------------------------------------ combat
  /** kind: 'kick' or a weapon id. Swings toward whichever side the nearest rider is on. */
  startAttack(e, kind) {
    if (e.attack || e.crash > 0 || e.finishTime !== null) return false;
    let side = 1, bestDs = 5;
    for (const o of this.riders) {
      if (o === e || this.out(o)) continue;
      const ds = Math.abs(o.bike.s - e.bike.s);
      if (ds < bestDs && Math.abs(o.bike.d - e.bike.d) < 4) {
        bestDs = ds;
        side = o.bike.d >= e.bike.d ? 1 : -1;
      }
    }
    e.attack = { kind, side, t: 0, w: WEAPONS[kind], hit: false };
    return true;
  }

  combat(dt) {
    for (const e of this.riders) {
      if (e.isCop && e.state === 'off') continue;
      if (e.crash > 0) {
        e.bike.v *= Math.exp(-dt * 0.8);
        if (e.isCop) continue;         // a downed cop is out for the rest of the race
        e.crash -= dt;
        if (e.crash <= 0) {            // back on the bike
          e.crash = 0;
          e.bike.reset(e.bike.s, clamp(e.bike.d, -4, 4));
          e.health = 70;
        }
        continue;
      }
      e.sinceHit += dt;
      if (e.sinceHit > 5) e.health = Math.min(100, e.health + 3 * dt);

      const a = e.attack;
      if (!a) continue;
      a.t += dt;
      if (!a.hit && a.t >= a.w.dur * a.w.hitAt) {
        a.hit = true;
        let target = null, bestGap = a.w.reach;
        for (const o of this.riders) {
          if (o === e || this.out(o)) continue;
          const gapD = (o.bike.d - e.bike.d) * a.side;
          if (Math.abs(o.bike.s - e.bike.s) <= REACH_S && gapD > 0.2 && gapD <= bestGap) {
            bestGap = gapD;
            target = o;
          }
        }
        if (target) this.land(e, target, a);
        else this.events.push({ type: 'miss', by: e, kind: a.kind });
      }
      if (a.t >= a.w.dur) e.attack = null;
    }
  }

  land(by, target, a) {
    const scale = target.isPlayer ? this.D.dmgIn : by.isPlayer ? this.D.dmgOut : 1;
    target.health -= a.w.dmg * scale;
    target.sinceHit = 0;
    target.bike.push += a.side * a.w.push;
    target.bike.rel += a.side * 0.07;
    target.bike.v *= 0.96;
    this.events.push({ type: 'hit', by, target, kind: a.kind, side: a.side });
    if (target.health <= 0) {
      target.health = 0;
      target.crash = WIPEOUT_TIME;
      target.attack = null;
      if (target.isCop) target.state = 'down';
      this.events.push({ type: 'wipeout', who: target, by });
    }
  }

  /** Entrants in race order: finishers by time, then everyone else by distance. */
  standings() {
    return [...this.entrants].sort((a, b) => {
      if (!!a.busted !== !!b.busted) return a.busted ? 1 : -1;
      if (a.finishTime !== null || b.finishTime !== null) {
        if (a.finishTime === null) return 1;
        if (b.finishTime === null) return -1;
        return a.finishTime - b.finishTime;
      }
      return b.bike.s - a.bike.s;
    });
  }
}
