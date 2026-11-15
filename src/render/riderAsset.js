// Skinned rider character (public/models/rider.gltf, built by tools/build-rider.mjs).
// The mesh has a Mixamo skeleton; instead of baked animation clips, the bones are posed every frame:
// the hips and spine sit in a riding tuck, and each arm and leg is solved with two-bone IK toward a
// hand or foot target, so the same rig rides, punches, swings and kicks.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const SCALE = 0.01;                    // source is in centimetres
const UP = new THREE.Vector3(0, 1, 0);
const _pq = new THREE.Quaternion(), _q = new THREE.Quaternion(), _d = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _e = new THREE.Vector3(), _t = new THREE.Vector3();

export function loadRiderAsset(url = '/models/rider.gltf') {
  return new GLTFLoader().loadAsync(url).then((gltf) => ({ scene: gltf.scene }));
}

/** Turn `bone` so its length axis (local +Y) points along world direction `dir`, starting from its rest pose. */
function aim(bone, rest, dir) {
  bone.parent.getWorldQuaternion(_pq);
  _q.copy(_pq).multiply(rest);
  _a.copy(UP).applyQuaternion(_q);
  _d.setFromUnitVectors(_a, _b.copy(dir).normalize());
  _q.premultiply(_d);
  bone.quaternion.copy(_pq.invert()).multiply(_q);
  bone.updateWorldMatrix(false, true);
}

/**
 * One rider. `suit` recolours the red parts of the source texture.
 * root: add to the bike's rider group. seat(pos): where the hips sit (rider-local).
 */
export function createRig(asset, suit) {
  const root = cloneSkinned(asset.scene);
  root.scale.setScalar(SCALE);
  const bones = {};
  const find = (re) => { let hit = null; root.traverse((o) => { if (!hit && o.isBone && re.test(o.name)) hit = o; }); return hit; };
  const NAMES = {
    hips: /Hips_/, spine: /Spine_/, spine2: /Spine2_/, neck: /Neck_/, head: /[^p]Head_0/,
    armL: /LeftArm_/, foreL: /LeftForeArm_/, handL: /LeftHand_/, armR: /RightArm_/, foreR: /RightForeArm_/, handR: /RightHand_/,
    legL: /LeftUpLeg_/, shinL: /LeftLeg_/, footL: /LeftFoot_/, legR: /RightUpLeg_/, shinR: /RightLeg_/, footR: /RightFoot_/,
  };
  const rest = {};
  for (const k in NAMES) { bones[k] = find(NAMES[k]); rest[k] = bones[k].quaternion.clone(); }
  const hipOffset = bones.hips.position.clone().multiplyScalar(SCALE);

  // fingers: each knuckle curls about the axis that swings it from the T-pose toward the palm (down)
  const fingers = { 1: [], [-1]: [] };
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    const m = o.isBone && /(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)([123])_/.exec(o.name);
    if (!m || !o.children[0]) return;
    const dir = o.children[0].getWorldPosition(new THREE.Vector3()).sub(o.getWorldPosition(_a)).normalize();
    const axis = dir.cross(_b.set(0, -1, 0)).normalize().applyQuaternion(o.getWorldQuaternion(_q).invert());
    fingers[m[1] === 'Left' ? 1 : -1].push({ bone: o, rest: o.quaternion.clone(), axis, gain: m[2] === 'Thumb' ? 0.35 : 1 });
  });

  const uSuit = { value: new THREE.Color(suit) };
  root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    o.castShadow = true;
    o.frustumCulled = false;             // bounds are for the T-pose at the origin
    o.material = o.material.clone();
    o.material.onBeforeCompile = (sh) => {
      sh.uniforms.uSuit = uSuit;
      sh.fragmentShader = sh.fragmentShader
        .replace('void main() {', 'uniform vec3 uSuit;\nvoid main() {')
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            float mx = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
            float mn = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
            float sat = mx > 0.0 ? (mx - mn) / mx : 0.0;
            diffuseColor.rgb = mix(diffuseColor.rgb, uSuit * (0.25 + mx * 1.6), smoothstep(0.3, 0.55, sat));
          }`);
    };
  });

  /** Two-bone IK: root joint stays put, the end reaches for `target`, the middle joint bends toward `pole`. */
  function limb(upper, lower, end, target, pole) {
    upper.getWorldPosition(_c);
    const l1 = lower.position.length() * SCALE, l2 = end.position.length() * SCALE;
    _t.copy(target).sub(_c);
    const dist = Math.min(_t.length(), (l1 + l2) * 0.999);
    _t.normalize();
    const along = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
    const out = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    _e.copy(pole).sub(_c);
    _e.addScaledVector(_t, -_e.dot(_t));                       // part of the pole direction square to the limb
    if (_e.lengthSq() < 1e-8) _e.set(0, -1, 0).addScaledVector(_t, _t.y);
    _e.normalize().multiplyScalar(out).addScaledVector(_t, along);   // shoulder -> elbow
    const reach = _t.clone().multiplyScalar(dist).sub(_e);           // elbow -> hand
    aim(bones[upper.userData.key], rest[upper.userData.key], _e);
    aim(bones[lower.userData.key], rest[lower.userData.key], reach);
  }
  for (const k in bones) bones[k].userData.key = k;

  return {
    root,
    /** Sit the hips at world point `seat`, lean the torso along `torso`, and look along `look` (world directions). */
    body(seatLocal, torso, look) {
      root.position.copy(seatLocal).sub(hipOffset);
      root.updateWorldMatrix(true, true);
      aim(bones.hips, rest.hips, torso);
      aim(bones.neck, rest.neck, _c.copy(torso).lerp(look, 0.5));
      aim(bones.head, rest.head, look);
    },
    /** side: +1 = model +x (the character's left). target/pole are world points. */
    arm(side, target, pole) { limb(side > 0 ? bones.armL : bones.armR, side > 0 ? bones.foreL : bones.foreR, side > 0 ? bones.handL : bones.handR, target, pole); },
    leg(side, target, pole) { limb(side > 0 ? bones.legL : bones.legR, side > 0 ? bones.shinL : bones.shinR, side > 0 ? bones.footL : bones.footR, target, pole); },
    /** Curl the fingers: 0 = open hand, 1 = clenched fist. */
    fist(side, amount) {
      for (const f of fingers[side]) f.bone.quaternion.copy(f.rest).multiply(_q.setFromAxisAngle(f.axis, amount * 1.45 * f.gain));
    },
    hand(side, out) { return (side > 0 ? bones.handL : bones.handR).getWorldPosition(out); },
    head(out) { return bones.head.getWorldPosition(out); },
  };
}
