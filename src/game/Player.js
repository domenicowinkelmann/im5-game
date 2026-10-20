import * as THREE from 'three';
import { getItem } from '../shared/items.js';

const G = 9.81;
const SINK = 5.3;
const DRAG = 0.00135;
const MIN_V = 16, MAX_V = 85;
const NEUTRAL_PITCH = -0.26;
const PITCH_RANGE = 0.62;
const TURN_RATE = 1.45;
const MAX_YAW = 1.15;
const MODEL_SCALE = 1.7;

const clamp = THREE.MathUtils.clamp;

class Ribbon {
  constructor(scene, n = 42, width = 0.55) {
    this.n = n; this.width = width; this.pts = [];
    this.posArr = new Float32Array(n * 2 * 3);
    this.colArr = new Float32Array(n * 2 * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.colArr, 4).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.tmpC = new THREE.Color();
  }
  reset() { this.pts.length = 0; this.mesh.visible = false; }
  push(p, side) {
    const pt = this.pts.length >= this.n ? this.pts.pop() : { p: new THREE.Vector3(), s: new THREE.Vector3() };
    pt.p.copy(p); pt.s.copy(side);
    this.pts.unshift(pt);
  }
  update(colorFn) {
    const L = this.pts.length;
    if (L < 2) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    for (let i = 0; i < this.n; i++) {
      const has = i < L;
      const pt = this.pts[Math.min(i, L - 1)];
      const f = i / (this.n - 1);
      const w = has ? this.width * (1 - f * 0.6) : 0;
      const o = i * 6;
      this.posArr[o] = pt.p.x + pt.s.x * w; this.posArr[o + 1] = pt.p.y + pt.s.y * w; this.posArr[o + 2] = pt.p.z + pt.s.z * w;
      this.posArr[o + 3] = pt.p.x - pt.s.x * w; this.posArr[o + 4] = pt.p.y - pt.s.y * w; this.posArr[o + 5] = pt.p.z - pt.s.z * w;
      colorFn(f, this.tmpC);
      const a = has ? (1 - f) * 0.8 : 0;
      const c = i * 8;
      for (const k of [0, 4]) {
        this.colArr[c + k] = this.tmpC.r; this.colArr[c + k + 1] = this.tmpC.g;
        this.colArr[c + k + 2] = this.tmpC.b; this.colArr[c + k + 3] = a;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

export class Player {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';
    this.model = new THREE.Group();
    this.group.add(this.model);

    this.suitMat = new THREE.MeshStandardMaterial({ color: '#ff7a1a', roughness: 0.6, side: THREE.DoubleSide, flatShading: true });
    this.accentMat = new THREE.MeshStandardMaterial({ color: '#1d2633', roughness: 0.7 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.3, metalness: 0.2 });

    const shape = new THREE.Shape();
    shape.moveTo(0, 0.85); shape.lineTo(1.15, 0.25); shape.lineTo(0.32, -0.95);
    shape.lineTo(0, -0.55); shape.lineTo(-0.32, -0.95); shape.lineTo(-1.15, 0.25); shape.closePath();
    const wingGeo = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
    this.model.add(new THREE.Mesh(wingGeo, this.suitMat));

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 1.5), this.accentMat);
    body.position.set(0, 0.12, -0.05);
    this.model.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), helmetMat);
    head.position.set(0, 0.16, -0.95);
    this.model.add(head);
    this.model.scale.setScalar(MODEL_SCALE);
    scene.add(this.group);

    this.trails = [new Ribbon(scene), new Ribbon(scene)];
    this.trailC1 = new THREE.Color('#ffffff');
    this.trailC2 = new THREE.Color('#ffffff');
    this.rainbow = false;

    this.pos = this.group.position;
    this.yaw = 0; this.pitch = NEUTRAL_PITCH; this.roll = 0; this.speed = 38;
    this.clearance = 99;
    this._tip = new THREE.Vector3();
    this._side = new THREE.Vector3();
  }

  setLoadout(equipped) {
    const suit = getItem(equipped.suit) || getItem('suit_orange');
    const trail = getItem(equipped.trail) || getItem('trail_white');
    this.suitMat.color.set(suit.color);
    this.suitMat.metalness = suit.metal ? 0.85 : 0;
    this.suitMat.roughness = suit.metal ? 0.25 : 0.6;
    this.suitMat.emissive.set(suit.glow ? suit.color : '#000000');
    this.suitMat.emissiveIntensity = suit.glow ? 0.35 : 0;
    this.accentMat.color.set(suit.accent || '#1d2633');
    this.trailC1.set(trail.color);
    this.trailC2.set(trail.color2 || trail.color);
    this.rainbow = !!trail.rainbow;
  }

  reset(terrain) {
    const z = 0, x = terrain.centerX(z);
    this.pos.set(x, terrain.height(x, z) + 70, z);
    this.yaw = 0; this.pitch = NEUTRAL_PITCH; this.roll = 0; this.speed = 38;
    this.clearance = 70;
    this.group.visible = true;
    this.trails.forEach((t) => t.reset());
  }

  forwardH(out) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

  update(dt, input, terrain, t) {
    let target = NEUTRAL_PITCH + input.pitch * PITCH_RANGE;
    if (this.speed < 20) target = Math.min(target, -0.35 + (this.speed - MIN_V) * 0.05);
    this.pitch += (target - this.pitch) * Math.min(1, dt * 3.2);

    this.yaw = clamp(this.yaw - input.turn * TURN_RATE * dt, -MAX_YAW, MAX_YAW);
    this.roll += (-input.turn * 0.75 - this.roll) * Math.min(1, dt * 5);

    const acc = G * -Math.sin(this.pitch) - DRAG * this.speed * this.speed;
    this.speed = clamp(this.speed + acc * dt, MIN_V, MAX_V);

    const h = this.speed * Math.cos(this.pitch);
    this.pos.x += -Math.sin(this.yaw) * h * dt;
    this.pos.z += -Math.cos(this.yaw) * h * dt;
    this.pos.y += (this.speed * Math.sin(this.pitch) - SINK) * dt;

    this.group.rotation.set(this.pitch, this.yaw, this.roll + Math.sin(t * 7) * 0.02);
    this.clearance = this.pos.y - terrain.height(this.pos.x, this.pos.z);

    this.group.updateMatrixWorld();
    this._side.set(1, 0, 0).applyQuaternion(this.group.quaternion);
    [-1, 1].forEach((s, i) => {
      this._tip.set(s * 1.15, 0, 0.25).applyMatrix4(this.model.matrixWorld);
      this.trails[i].push(this._tip, this._side);
    });
    this.updateTrails(t);
  }

  updateTrails(t) {
    const fn = (f, out) => {
      if (this.rainbow) out.setHSL((f * 0.8 + t * 0.4) % 1, 0.9, 0.6);
      else out.copy(this.trailC1).lerp(this.trailC2, f);
    };
    this.trails.forEach((tr) => tr.update(fn));
  }
}
