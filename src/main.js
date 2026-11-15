import * as THREE from 'three';
import { buildTrack } from './sim/track.js';
import { VMAX } from './sim/bike.js';
import { Race, WEAPONS, DIFFICULTY } from './sim/race.js';
import { COURSES, COURSE_IDS } from './sim/courses.js';
import { COP } from './sim/cast.js';
import { createWorld } from './render/world.js';
import { createBike } from './render/bikeModel.js';
import { createAudio } from './audio.js';
import { loadBikeAsset } from './render/bikeAsset.js';
import { loadRiderAsset } from './render/riderAsset.js';
import { initAnalytics, track as report } from './analytics.js';

const $ = (id) => document.getElementById(id);
const tracks = {};
const getTrack = (id) => (tracks[id] ??= buildTrack(COURSES[id]));
let courseId = 'country';
try { const saved = localStorage.getItem('bb.course'); if (COURSE_IDS.includes(saved)) courseId = saved; } catch { /* storage unavailable */ }
let track = getTrack(courseId);
const race = new Race(track);
const bike = race.player.bike;
const world = createWorld($('game'));
for (const e of race.riders) {
  e.model = createBike({ ...e.who, headScale: e.isPlayer ? 1.1 : e.isCop ? 1.2 : 1.45 });
  world.scene.add(e.model.root);
  if (!e.isCop) continue;
  // red/blue beacons on the tail
  e.beacons = [0xff2018, 0x1c5cff].map((c, j) => {
    const mat = new THREE.MeshStandardMaterial({ color: 0x222226, emissive: c, emissiveIntensity: 0 });
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.12, 0.16), mat);
    lamp.position.set(j ? 0.11 : -0.11, 1.03, -0.78);
    e.model.tilt.add(lamp);
    return mat;
  });
}
const audio = createAudio();
// detailed bike mesh, fitted once it has loaded (add ?bike=classic to the URL to keep the primitive bikes)
if (new URLSearchParams(location.search).get('bike') !== 'classic') {
  loadBikeAsset().then((asset) => { for (const e of race.riders) e.model.useAsset(asset); }).catch((err) => console.warn('bike mesh not loaded, using primitive bikes', err));
  loadRiderAsset().then((asset) => { for (const e of race.riders) e.model.useRider(asset); }).catch((err) => console.warn('rider mesh not loaded, using primitive riders', err));
}

// ---------------------------------------------------------------- input
const keys = new Set();
const input = { throttle: 0, brake: 0, steer: 0 };
const ATTACK_KEYS = { KeyJ: 'fist', KeyK: 'kick', KeyL: 'bat', KeyI: 'chain', KeyZ: 'fist', KeyX: 'kick', KeyB: 'bat', KeyV: 'chain' };
const GAME_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter'];
window.addEventListener('keydown', (e) => {
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'Escape' && performance.now() - lockLostAt < 300) return;   // this press already paused via the lock
  if (e.code === 'Escape' && (paused || state === 'race' || state === 'countdown')) { setPaused(!paused); return; }
  if (paused) {
    if (e.code === 'Enter') { setPaused(false); startRace(); }
    if (e.code === 'KeyQ') { report('race_quit', { course: courseId, difficulty: race.difficulty, distance_m: Math.round(bike.s) }); setPaused(false); setState('title'); }
    return;
  }
  keys.add(e.code);
  audio.start();
  if (e.code === 'Enter') {
    if (state === 'title') setState('lineup');
    else if (state === 'lineup' || state === 'finished') startRace();
  }
  if (e.code === 'KeyM') audio.toggleMute();
  if (e.code === 'KeyC' && (state === 'race' || state === 'countdown' || state === 'finished')) {
    camMode = (camMode + 1) % CAMS.length;
    toast(race.player.who, `CAMERA: ${CAMS[camMode].name}`, false);
  }
  if (state === 'title' || state === 'lineup') {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') setDifficulty(-1);
    if (e.code === 'ArrowRight' || e.code === 'KeyD') setDifficulty(1);
    if (e.code === 'ArrowUp' || e.code === 'KeyW') setCourse(-1);
    if (e.code === 'ArrowDown' || e.code === 'KeyS') setCourse(1);
  }
  if (state === 'race') {
    const me = race.player;
    if (e.code === 'KeyR' && me.crash <= 0) bike.reset(bike.s, 0);
    const attack = ATTACK_KEYS[e.code];
    if (attack) tryAttack(attack);
  }
});
// mouse: the wheel picks a move, left click throws it
const MOVES = [['kick', 'KICK'], ['chain', 'CHAIN'], ['fist', 'PUNCH'], ['bat', 'BAT']];
let move = 2, wheelAcc = 0;
function selectMove(i) {
  move = (i + MOVES.length) % MOVES.length;
  document.querySelectorAll('#moves span').forEach((el, n) => el.classList.toggle('on', n === move));
}
window.addEventListener('wheel', (e) => {
  if (paused || (state !== 'race' && state !== 'countdown')) return;
  e.preventDefault();
  // one notch of a wheel is ~100; a trackpad sends many small deltas, so add them up
  wheelAcc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
  if (Math.abs(wheelAcc) >= 50) { selectMove(move + Math.sign(wheelAcc)); wheelAcc = 0; }
}, { passive: false });
// pointerdown rather than mousedown: it also fires for touchpad taps and pens, and is not swallowed by a drag
window.addEventListener('pointerdown', (e) => {
  if (!paused && (state === 'race' || state === 'countdown')) lockMouse();   // recapture if the lock was refused earlier
  if (e.button !== 0 || paused || state !== 'race') return;
  audio.start();
  tryAttack(MOVES[move][0]);
});
window.addEventListener('mousedown', (e) => { if (state === 'race' || state === 'countdown') e.preventDefault(); });  // no text selection or drags
window.addEventListener('dragstart', (e) => e.preventDefault());

// While riding, the mouse is captured by the game (pointer lock): the cursor is hidden and cannot drift onto
// the browser's tab bar, another window or a second monitor, where clicks and scrolling would miss the game.
let lockLostAt = -1e9;
const lockTarget = document.getElementById('game');
const riding = () => !paused && (state === 'race' || state === 'countdown');
function lockMouse() {
  if (document.pointerLockElement === lockTarget || !lockTarget.requestPointerLock) return;
  try { lockTarget.requestPointerLock()?.catch?.(() => {}); } catch { /* refused: the next click asks again */ }
}
function unlockMouse() { if (document.pointerLockElement) document.exitPointerLock(); }
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) { if (!riding()) unlockMouse(); }
  else if (riding()) { lockLostAt = performance.now(); setPaused(true); }          // the browser's own Escape releases the mouse without a key event
});
window.addEventListener('contextmenu', (e) => { if (state === 'race' || state === 'countdown') e.preventDefault(); });

/** Throw a move now, or remember it briefly so a press made just before the last swing ends still counts. */
let queued = null;
function tryAttack(kind) {
  queued = race.startAttack(race.player, kind) ? null : { kind, left: 0.35 };
}
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); if (state === 'race' || state === 'countdown') setPaused(true); });
const down = (...codes) => codes.some((c) => keys.has(c));

function readInput() {
  if (state === 'race') {
    input.throttle = down('KeyW', 'ArrowUp') ? 1 : 0;
    input.brake = down('KeyS', 'ArrowDown', 'Space') ? 1 : 0;
    input.steer = (down('KeyD', 'ArrowRight') ? 1 : 0) - (down('KeyA', 'ArrowLeft') ? 1 : 0);
  } else {
    input.throttle = 0;
    // after the line: roll to a stop, easing back to the lane centre
    input.steer = state === 'finished' ? Math.max(-1, Math.min(1, -bike.d * 0.1 - bike.rel * 3)) : 0;
    input.brake = state === 'finished' ? 0.6 : 1;
  }
}

// ---------------------------------------------------------------- UI helpers
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][n % 10 < 4 && (n % 100) - (n % 10) !== 10 ? n % 10 : 0]}`;

/** Portrait from /portraits/<id>.png or .svg, with an initials badge while it loads. */
function portrait(who) {
  const el = document.createElement('div');
  el.className = 'portrait';
  el.style.setProperty('--c', hex(who.color));
  const badge = document.createElement('span');
  badge.textContent = who.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  el.append(badge);
  if (who.id !== 'you') {
    const img = new Image();
    img.alt = who.name;
    img.onload = () => el.replaceChildren(img);
    // painted PNG wins when present; otherwise fall back to the drawn SVG
    img.onerror = () => { img.onerror = null; img.src = `/portraits/${who.id}.svg`; };
    img.src = `/portraits/${who.id}.png`;
  }
  return el;
}

for (const r of [...race.rivals].sort((a, b) => b.who.skill - a.who.skill)) {
  const card = document.createElement('div');
  card.className = 'card';
  card.style.setProperty('--c', hex(r.who.color));
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = r.who.name;
  const line = document.createElement('div');
  line.className = 'line';
  line.textContent = `“${r.who.tagline}”`;
  card.append(portrait(r.who), name, line);
  $('cards').append(card);
}

function flash(text) {
  const b = $('banner');
  b.textContent = text;
  b.classList.remove('pop');
  void b.offsetWidth;
  b.classList.add('pop');
}
function toast(who, text, bad) {
  const t = $('toast');
  t.replaceChildren(portrait(who), document.createTextNode(text));
  t.className = bad ? 'bad' : '';
  void t.offsetWidth;
  t.classList.add('show');
}

// ---------------------------------------------------------------- difficulty
const LEVELS = Object.keys(DIFFICULTY);
try { const saved = localStorage.getItem('bb.diff'); if (LEVELS.includes(saved)) race.difficulty = saved; } catch { /* storage unavailable */ }
function setDifficulty(step) {
  const i = Math.min(LEVELS.length - 1, Math.max(0, LEVELS.indexOf(race.difficulty) + step));
  race.difficulty = LEVELS[i];
  try { localStorage.setItem('bb.diff', race.difficulty); } catch { /* ignore */ }
  for (const el of document.querySelectorAll('.level b')) el.textContent = DIFFICULTY[race.difficulty].label;
  for (const el of document.querySelectorAll('.level')) el.dataset.level = race.difficulty;
}
setDifficulty(0);

// ---------------------------------------------------------------- race flow
let state = 'title';           // title | lineup | countdown | race | finished
let countdown = 0, lastCount = 0, lastPlace = 0, shownFinishers = -1;
let best = null;

// ---------------------------------------------------------------- course
function setCourse(step) {
  const n = COURSE_IDS.length;
  courseId = COURSE_IDS[(COURSE_IDS.indexOf(courseId) + step + n) % n];
  const C = COURSES[courseId];
  try { localStorage.setItem('bb.course', courseId); } catch { /* ignore */ }
  track = getTrack(courseId);
  race.setCourse(track, C.posts);
  world.setCourse(track);
  best = null;
  try { best = JSON.parse(localStorage.getItem(`bb.best.${C.seed}`)); } catch { /* storage unavailable */ }
  for (const el of document.querySelectorAll('.course b')) el.textContent = C.name;
  for (const el of document.querySelectorAll('.course span')) el.textContent = C.blurb.toUpperCase();
}

let paused = false;
function setPaused(on) {
  paused = on;
  keys.clear();
  document.body.classList.toggle('paused', on);
  if (on || (state !== 'race' && state !== 'countdown')) unlockMouse(); else lockMouse();
}

function setState(s) {
  state = s;
  document.body.className = ['title', 'lineup', 'finished'].includes(s) ? s : 'riding';
  if (s === 'countdown') lockMouse(); else if (s !== 'race') unlockMouse();
}
function startRace() {
  race.reset();
  countdown = 3.2;
  lastCount = 4;
  lastPlace = race.entrants.length;
  track.sample(bike.s, sample);
  camH = sample.h;
  $('best').textContent = best ? `BEST ${fmt(best)}` : '';
  report('race_start', { course: courseId, difficulty: race.difficulty });
  setState('countdown');
}
function finishRace() {
  const t = race.player.finishTime;
  const isBest = best === null || t < best;
  if (isBest) {
    best = t;
    try { localStorage.setItem(`bb.best.${COURSES[courseId].seed}`, JSON.stringify(best)); } catch { /* ignore */ }
  }
  const place = race.finished.indexOf(race.player) + 1;
  report('race_finish', { course: courseId, difficulty: race.difficulty, place, time_s: Math.round(t * 10) / 10, new_best: isBest });
  $('ftag').textContent = 'COURSE COMPLETE';
  $('fplace').textContent = place === 1 ? 'You win!' : `${ordinal(place)} place`;
  $('ftime').textContent = fmt(t);
  $('fbest').textContent = fmt(best);
  $('newbest').style.display = isBest ? 'inline' : 'none';
  shownFinishers = -1;
  setState('finished');
}
function busted() {
  flash('BUSTED');
  report('race_busted', { course: courseId, difficulty: race.difficulty, distance_m: Math.round(bike.s) });
  $('ftag').textContent = 'PULLED OVER BY THE POLICE';
  $('fplace').textContent = 'Busted!';
  $('ftime').textContent = '—';
  $('fbest').textContent = best ? fmt(best) : '—';
  $('newbest').style.display = 'none';
  shownFinishers = -1;
  setState('finished');
}
function renderResults() {
  if (shownFinishers === race.finished.length) return;
  shownFinishers = race.finished.length;
  const rows = race.standings().map((e, i) => {
    const li = document.createElement('li');
    if (e.isPlayer) li.className = 'me';
    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = i + 1;
    const time = document.createElement('span');
    time.className = 't';
    time.textContent = e.busted ? 'busted' : e.finishTime === null ? 'still riding' : fmt(e.finishTime);
    li.append(rank, portrait(e.who), document.createTextNode(e.who.name), time);
    return li;
  });
  $('results').replaceChildren(...rows);
}

// ---------------------------------------------------------------- view
const sample = {}, ahead = {}, behind = {}, tmp = {};
const pos = new THREE.Vector3();
let camH = 0, camY = 3, shake = 0, orbit = 0.6;
// back: metres behind the bike (negative = ahead); side: metres to the right; look: metres ahead to aim at
const CAMS = [
  { name: 'CHASE', back: 5, up: 2, side: 0, look: 12, lookUp: 1.1, fov: 62, chase: true },
  { name: 'WIDE', back: 9.5, up: 3.8, side: 0, look: 12, lookUp: 1.1, fov: 58, chase: true },
  { name: 'FRONT', back: -5, up: 1.6, side: 0, look: 0, lookUp: 1.0, fov: 50 },
  { name: 'SIDE', back: -0.6, up: 1.5, side: 5.5, look: 0.6, lookUp: 0.9, fov: 50 },
  { name: 'RIDER', back: -0.55, up: 1.52, side: 0, look: 30, lookUp: 1.0, fov: 70, chase: true },
];
let camMode = 0;

function placeModel(e, dt) {
  const b = e.bike, m = e.model;
  track.sample(b.s, tmp);
  m.root.position.set(tmp.x - Math.cos(tmp.h) * b.d, b.y, tmp.z + Math.sin(tmp.h) * b.d);
  const target = b.air ? Math.atan2(b.vy, Math.max(8, b.v)) * 0.7 : Math.atan(tmp.slope);
  m.pitch += (target - m.pitch) * Math.min(1, dt * 10);
  m.update(b, dt, e);
  m.root.rotation.set(-m.pitch, tmp.h - b.rel + m.spin, 0);
}

function updateView(dt) {
  for (const e of race.riders) {
    if (e.isCop) {
      e.model.root.visible = e.state !== 'off';
      const on = e.state === 'chase', flip = Math.floor(performance.now() / 140) % 2;
      e.beacons[0].emissiveIntensity = on && flip ? 2.5 : 0;
      e.beacons[1].emissiveIntensity = on && !flip ? 2.5 : 0;
      if (e.state === 'off') continue;
    }
    placeModel(e, dt);
  }
  track.sample(bike.s, sample);
  pos.copy(race.player.model.root.position);
  world.follow(pos);

  const cam = world.camera;
  const speedT = bike.v / VMAX;
  shake = Math.max(shake * Math.exp(-dt * 6), Math.min(1, bike.impact / 9));
  bike.impact = 0;
  const rumble = speedT * speedT * 0.025 + (bike.offroad ? 0.05 * Math.min(1, bike.v / 15) : 0) + shake * 0.28;

  if (state === 'title' || state === 'lineup') {
    // slow orbit around the grid
    orbit += dt * 0.18;
    track.sample(bike.s + 11, ahead);
    // an oval lined up with the road: long along it, narrow across, so it never swings into the roadside
    const al = Math.cos(orbit) * 15, ac = Math.sin(orbit) * 8;
    const fx = Math.sin(ahead.h), fz = Math.cos(ahead.h);
    cam.position.set(ahead.x + fx * al - fz * ac, ahead.y + 3.2, ahead.z + fz * al + fx * ac);
    cam.lookAt(ahead.x, ahead.y + 0.9, ahead.z);
    cam.fov = 46;
  } else {
    const c = CAMS[camMode];
    camH += (sample.h - bike.rel * 0.55 - camH) * (1 - Math.exp(-dt * 6));
    const back = c.back + (c.chase ? speedT * 1.5 : 0), up = c.up + (c.chase ? speedT * 0.35 : 0);
    const fx = Math.sin(camH), fz = Math.cos(camH);          // forward
    const rx = -Math.cos(camH), rz = Math.sin(camH);         // right
    track.sample(bike.s - back, behind);
    track.sample(bike.s + 14, ahead);
    const wantY = Math.max(pos.y + up, behind.y + 0.9);
    camY += (wantY - camY) * (1 - Math.exp(-dt * 7));
    cam.position.set(
      pos.x - fx * back + rx * c.side + (Math.random() - 0.5) * rumble,
      camY + (Math.random() - 0.5) * rumble,
      pos.z - fz * back + rz * c.side + (Math.random() - 0.5) * rumble,
    );
    const lookY = c.look > 5 ? (pos.y + ahead.y) * 0.5 + c.lookUp : pos.y + c.lookUp;
    cam.lookAt(pos.x + fx * c.look, lookY, pos.z + fz * c.look);
    if (c.chase) cam.rotateZ(-bike.lean * 0.13);
    cam.fov = c.fov + speedT * (c.chase ? 22 : 8);
  }
  cam.updateProjectionMatrix();
}

// ---------------------------------------------------------------- combat feedback
function drainEvents() {
  const me = race.player;
  for (const ev of race.events) {
    if (ev.type === 'miss') {
      if (ev.by === me) audio.hit(0.3, true);
    } else if (ev.type === 'hit') {
      const near = ev.by === me || ev.target === me;
      const power = WEAPONS[ev.kind].dmg / 28;
      audio.hit(near ? power : power * 0.3);
      ev.target.model.jolt(ev.side);
      if (ev.target === me) {
        shake = Math.max(shake, 0.5 + power * 0.4);
        const h = $('hurt');
        h.classList.remove('on');
        void h.offsetWidth;
        h.classList.add('on');
      } else if (ev.by === me) shake = Math.max(shake, 0.2 + power * 0.2);
    } else if (ev.type === 'police') {
      if (ev.on) toast(COP, "POLICE! DON'T STOP", true);
      else if (!race.cops.some((c) => c.state === 'chase')) toast(COP, 'YOU LOST THE COPS', false);
    } else if (ev.type === 'busted') {
      if (state === 'race') busted();
    } else if (ev.type === 'wipeout') {
      if (ev.who === me) { flash('WIPEOUT'); toast(ev.by.who, `${ev.by.who.name.toUpperCase()} TOOK YOU DOWN`, true); }
      else if (ev.by === me) toast(ev.who.who, `WIPED OUT ${ev.who.who.name.toUpperCase()}`, false);
    }
  }
  race.events.length = 0;
}

let foeShown = null;
function updateVitals() {
  const me = race.player;
  const mine = $('myhp');
  mine.firstChild.style.width = `${me.health}%`;
  mine.classList.toggle('low', me.health < 35);
  // nearest rival within brawling distance
  let foe = null, best = 10;
  for (const r of race.riders) {
    if (r.isPlayer || (r.isCop && r.state !== 'chase')) continue;
    const ds = Math.abs(r.bike.s - bike.s);
    if (ds < best) { best = ds; foe = r; }
  }
  $('foe').classList.toggle('on', !!foe);
  if (!foe) return;
  if (foe !== foeShown) {
    foeShown = foe;
    $('foeface').replaceChildren(portrait(foe.who));
    $('foename').textContent = `${foe.who.name.toUpperCase()} · ${foe.isCop ? 'BATON' : WEAPONS[foe.weapon].name}`;
  }
  const bar = $('foehp');
  bar.firstChild.style.width = `${foe.health}%`;
  bar.classList.toggle('low', foe.health < 35);
}

// ---------------------------------------------------------------- HUD
const hud = { speed: $('speed'), gear: $('gear'), rpm: $('rpmfill'), time: $('time'), prog: $('progfill'), dist: $('dist'), place: $('place'), of: $('of') };
hud.of.textContent = `/${race.entrants.length}`;

function updateHud() {
  hud.speed.textContent = Math.round(bike.v * 3.6);
  hud.gear.textContent = bike.gear;
  hud.rpm.style.width = `${(bike.rpm * 100).toFixed(1)}%`;
  hud.time.textContent = fmt(race.player.finishTime ?? race.time);
  const p = Math.min(1, Math.max(0, (bike.s - track.startS) / (track.finishS - track.startS)));
  hud.prog.style.width = `${(p * 100).toFixed(2)}%`;
  hud.dist.textContent = `${(Math.max(0, track.finishS - bike.s) / 1000).toFixed(1)} KM`;

  if (state === 'race') {
    const order = race.standings();
    const place = order.indexOf(race.player) + 1;
    hud.place.textContent = place;
    if (place < lastPlace) toast(order[place].who, `PASSED ${order[place].who.name.toUpperCase()}`, false);
    else if (place > lastPlace) toast(order[place - 2].who, `${order[place - 2].who.name.toUpperCase()} PASSED YOU`, true);
    lastPlace = place;
  }
  if (state === 'finished') renderResults();
  updateVitals();

  // police warning: distance to the nearest cop giving chase
  let near = Infinity;
  for (const c of race.cops) if (c.state === 'chase') near = Math.min(near, Math.abs(c.bike.s - bike.s));
  const chased = near < Infinity && state === 'race';
  $('police').classList.toggle('on', chased);
  if (chased) $('copdist').textContent = near < 8 ? 'ON YOU' : `${Math.round(near)} M`;
  siren = chased ? Math.max(0.25, 1 - near / 220) : 0;
}
let siren = 0;

// ---------------------------------------------------------------- loop
const DT = 1 / 120;
let last = performance.now(), acc = 0;

function tick(dt) {
  if (state === 'countdown') {
    countdown -= dt;
    const c = Math.ceil(countdown);
    if (c !== lastCount && c >= 1 && c <= 3) flash(String(c));
    lastCount = c;
    if (countdown <= 0) { setState('race'); flash('GO!'); }
  }
  readInput();
  if (queued && state === 'race') {
    queued.left -= dt;
    if (race.startAttack(race.player, queued.kind) || queued.left <= 0) queued = null;
  }
  if (state === 'title' || state === 'lineup') return;
  race.step(dt, input, state === 'race' || state === 'finished');
  if (state === 'race' && race.player.finishTime !== null) finishRace();
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) {
    acc += dt;
    while (acc >= DT) { tick(DT); acc -= DT; }
    drainEvents();
    updateView(dt);
    updateHud();
  }
  audio.update(bike.rpm, input.throttle, bike.v / VMAX, !paused && state !== 'title' && state !== 'lineup', siren);
  world.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// debug handle for automated checks
setCourse(0);

document.getElementById('moves').replaceChildren(...MOVES.map(([, label]) => Object.assign(document.createElement('span'), { textContent: label })));
selectMove(move);

initAnalytics();

window.__game = { get move() { return MOVES[move][0]; }, bike, get track() { return track; }, race, keys, get state() { return state; }, get paused() { return paused; }, tick, world, updateView, setCourse, drainEvents, updateHud };
