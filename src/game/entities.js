import * as THREE from 'three';
import { COIN_TYPES } from '../shared/economy.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const ROCK = new THREE.IcosahedronGeometry(1, 0);
const COIN_GEO = new THREE.CylinderGeometry(1, 1, 0.22, 20).rotateX(Math.PI / 2);
const DIAMOND_GEO = new THREE.OctahedronGeometry(1.3, 0);
const TREE_GEO = new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0);
const SPHERE = new THREE.SphereGeometry(1, 16, 10);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 12);

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
const M = {
  rock: std('#8a8178', { roughness: 1, flatShading: true }),
  rockDark: std('#6a625b', { roughness: 1, flatShading: true }),
  tree: std('#2d5a33', { flatShading: true }),
  bird: std('#2a2a30', { flatShading: true }),
  red: std('#d6262f', { roughness: 0.5 }),
  white: std('#f2f2f2', { roughness: 0.5 }),
  glass: std('#203040', { roughness: 0.15, metalness: 0.4 }),
  dark: std('#30343a'),
  blue: std('#2b5fd9', { roughness: 0.5 }),
};

const COIN_MATS = Object.fromEntries(Object.entries(COIN_TYPES).map(([k, t]) => [k,
  new THREE.MeshStandardMaterial({
    color: t.color,
    metalness: k === 'diamond' ? 0.1 : 0.85,
    roughness: k === 'diamond' ? 0.1 : 0.3,
    emissive: t.color,
    emissiveIntensity: k === 'diamond' ? 0.7 : 0.28,
    flatShading: k === 'diamond',
  })]));

const COIN_SCALE = { bronze: 1, silver: 1.05, gold: 1.3, diamond: 1 };

export function createCoin(type, x, y, z) {
  const mesh = new THREE.Mesh(type === 'diamond' ? DIAMOND_GEO : COIN_GEO, COIN_MATS[type]);
  mesh.scale.setScalar(COIN_SCALE[type]);
  mesh.position.set(x, y, z);
  mesh.rotation.y = Math.random() * Math.PI;
  return { type, mesh, radius: 2.8 * COIN_SCALE[type], collected: false };
}

function boxMesh(mat, b) {
  const m = new THREE.Mesh(BOX, mat);
  m.scale.set(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
  m.position.set((b.max[0] + b.min[0]) / 2, (b.max[1] + b.min[1]) / 2, (b.max[2] + b.min[2]) / 2);
  return m;
}

const inBox = (p, b, r) =>
  p.x > b.min[0] - r && p.x < b.max[0] + r &&
  p.y > b.min[1] - r && p.y < b.max[1] + r &&
  p.z > b.min[2] - r && p.z < b.max[2] + r;

export function createArch(terrain, z, x0, gap, openH, depth, rand) {
  const samples = [];
  for (const dz of [-depth / 2, 0, depth / 2]) {
    for (const dx of [-gap / 2, 0, gap / 2]) samples.push(terrain.height(x0 + dx, z + dz));
  }
  const gy = Math.max(...samples);
  const bottom = Math.min(...samples) - 14;
  const pw = 8;
  const roof = gy + openH;
  const top = roof + 9;
  const zf = z + depth / 2, zb = z - depth / 2;
  const boxes = [
    { min: [x0 - gap / 2 - pw, bottom, zb], max: [x0 - gap / 2, top, zf] },
    { min: [x0 + gap / 2, bottom, zb], max: [x0 + gap / 2 + pw, top, zf] },
    { min: [x0 - gap / 2 - pw, roof, zb], max: [x0 + gap / 2 + pw, top, zf] },
  ];
  const group = new THREE.Group();
  boxes.forEach((b, i) => group.add(boxMesh(i === 2 ? M.rock : M.rockDark, b)));
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(ROCK, M.rock);
    const s = 4 + rand() * 4;
    m.scale.set(s * 1.3, s * 0.7, s);
    m.position.set(x0 + (rand() - 0.5) * (gap + pw), top + s * 0.2, z + (rand() - 0.5) * depth);
    m.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    group.add(m);
  }
  const collisionBoxes = [...boxes, { min: [x0 - gap / 2 - pw - 4, top, zb - 4], max: [x0 + gap / 2 + pw + 4, top + 5, zf + 4] }];

  const opening = { x0: x0 - gap / 2, x1: x0 + gap / 2, yTop: roof, zFront: zf, zBack: zb };

  const n = Math.max(2, Math.round(depth / 7));
  const spots = [];
  for (let i = 0; i < n; i++) {
    spots.push({ type: 'gold', x: x0, y: gy + openH * 0.42, z: zf - (i + 0.5) * (depth / n) });
  }
  if (depth > 22 && rand() < 0.4) spots[Math.floor(n / 2)].type = 'diamond';

  const entity = {
    kind: 'arch', object: group, span: depth / 2 + 10, opening,
    wasInside: false, passed: false,
    getZ: () => z,
    hit(p, r) {
      for (const b of collisionBoxes) if (inBox(p, b, r)) return 'Felsbogen gestreift';
      return null;
    },
    inside(p) {
      const o = opening;
      return p.x > o.x0 && p.x < o.x1 && p.y < o.yTop && p.z < o.zFront && p.z > o.zBack;
    },
  };
  return { entity, spots };
}

export function createTrees(trees, centerZ) {
  const mesh = new THREE.InstancedMesh(TREE_GEO, M.tree, trees.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  trees.forEach((t, i) => {
    m.compose(p.set(t.x, t.y - 1, t.z), q, s.set(t.r, t.h, t.r));
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return {
    kind: 'trees', object: mesh, span: 100,
    getZ: () => centerZ,
    hit(pos, r) {
      for (const t of trees) {
        const dy = pos.y - (t.y - 1);
        if (dy < 0 || dy > t.h) continue;
        const dx = pos.x - t.x, dz = pos.z - t.z;
        const rad = t.r * (1 - dy / t.h) + r * 0.6;
        if (dx * dx + dz * dz < rad * rad) return 'Baum erwischt';
      }
      return null;
    },
  };
}

function makeBird() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(BOX, M.bird); body.scale.set(0.35, 0.25, 0.9); g.add(body);
  const wings = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    const w = new THREE.Mesh(BOX, M.bird); w.scale.set(1.3, 0.06, 0.45); w.position.x = side * 0.65;
    pivot.add(w); g.add(pivot);
    return { pivot, side };
  });
  g.userData.wings = wings;
  g.scale.setScalar(1.7);
  return g;
}

export function createBirdFlock(terrain, x, z, alt, count, rand) {
  const group = new THREE.Group();
  const birds = [];
  for (let i = 0; i < count; i++) {
    const b = makeBird();
    b.position.set((rand() - 0.5) * 16, (rand() - 0.5) * 6, (rand() - 0.5) * 14);
    birds.push({ mesh: b, phase: rand() * 6 });
    group.add(b);
  }
  const baseX = x, phase = rand() * 6, swing = 8 + rand() * 14;
  let bz = z;
  group.position.set(x, terrain.height(x, z) + alt, z);
  const tmp = new THREE.Vector3();
  return {
    kind: 'birds', object: group, span: 30,
    getZ: () => bz,
    update(dt, t) {
      bz += 7 * dt;
      const gx = baseX + Math.sin(t * 0.6 + phase) * swing;
      group.position.set(gx, terrain.height(gx, bz) + alt + Math.sin(t * 1.3 + phase) * 1.5, bz);
      for (const b of birds) {
        const a = Math.sin(t * 14 + b.phase) * 0.7;
        for (const w of b.mesh.userData.wings) w.pivot.rotation.z = a * w.side;
      }
    },
    hit(p, r) {
      for (const b of birds) {
        tmp.copy(b.mesh.position).multiplyScalar(1).add(group.position);
        if (tmp.distanceToSquared(p) < (1.9 + r) ** 2) return 'Vogelschwarm';
      }
      return null;
    },
  };
}

export function createHelicopter(x, y, z, rand) {
  const g = new THREE.Group();
  const add = (geo, mat, sx, sy, sz, px, py, pz, parent = g) => {
    const m = new THREE.Mesh(geo, mat); m.scale.set(sx, sy, sz); m.position.set(px, py, pz); parent.add(m); return m;
  };
  add(SPHERE, M.red, 2.2, 2.0, 3.4, 0, 0, 0);
  add(SPHERE, M.glass, 1.7, 1.4, 1.6, 0, 0.4, 2.2);
  add(BOX, M.red, 0.6, 0.7, 7, 0, 0.6, -6);
  add(BOX, M.white, 0.2, 2.2, 1.2, 0, 1.6, -9.2);
  add(CYL, M.dark, 0.25, 1, 0.25, 0, 2.3, 0);
  const rotor = new THREE.Group(); rotor.position.y = 2.8; g.add(rotor);
  for (let k = 0; k < 2; k++) {
    const b = add(BOX, M.dark, 15, 0.12, 0.5, 0, 0, 0, rotor); b.rotation.y = k * Math.PI / 2;
  }
  const tailRotor = new THREE.Group(); tailRotor.position.set(0.5, 1.6, -9.2); g.add(tailRotor);
  add(BOX, M.dark, 0.1, 3, 0.35, 0, 0, 0, tailRotor);
  for (const s of [-1, 1]) {
    add(BOX, M.dark, 0.2, 0.2, 5, s * 1.6, -2.4, 0);
    add(BOX, M.dark, 0.15, 0.8, 0.15, s * 1.6, -1.9, 1.2);
    add(BOX, M.dark, 0.15, 0.8, 0.15, s * 1.6, -1.9, -1.2);
  }
  g.position.set(x, y, z);
  const phase = rand() * 6, swing = 8 + rand() * 12;
  return {
    kind: 'heli', object: g, span: 20,
    getZ: () => z,
    update(dt, t) {
      g.position.x = x + Math.sin(t * 0.35 + phase) * swing;
      g.position.y = y + Math.sin(t * 0.8 + phase) * 1.5;
      g.rotation.z = Math.cos(t * 0.35 + phase) * 0.08;
      rotor.rotation.y += dt * 22;
      tailRotor.rotation.x += dt * 30;
    },
    hit(p, r) {
      const lx = p.x - g.position.x, ly = p.y - g.position.y, lz = p.z - g.position.z;
      if ((lx / (2.4 + r)) ** 2 + (ly / (2.2 + r)) ** 2 + (lz / (3.6 + r)) ** 2 < 1) return 'Helikopter';
      if (Math.abs(lx) < 0.6 + r && Math.abs(ly - 0.6) < 0.6 + r && lz < -2.5 && lz > -10) return 'Helikopter-Heck';
      if (Math.abs(ly - 2.8) < 0.5 + r && lx * lx + lz * lz < 7.5 * 7.5) return 'Rotorblatt';
      return null;
    },
  };
}

export function createPlane(terrain, offsetX, z, alt, rand) {
  const g = new THREE.Group();
  const add = (geo, mat, sx, sy, sz, px, py, pz, parent = g) => {
    const m = new THREE.Mesh(geo, mat); m.scale.set(sx, sy, sz); m.position.set(px, py, pz); parent.add(m); return m;
  };
  const fus = add(CYL, M.white, 1.3, 16, 1.3, 0, 0, 0); fus.rotation.x = Math.PI / 2;
  add(SPHERE, M.white, 1.3, 1.3, 2, 0, 0, 8);
  add(SPHERE, M.glass, 0.9, 0.7, 1.4, 0, 0.9, 6.2);
  add(BOX, M.blue, 20, 0.35, 3.5, 0, 0, 1);
  add(BOX, M.blue, 0.3, 3.2, 2.2, 0, 1.8, -7);
  add(BOX, M.blue, 6.5, 0.25, 1.8, 0, 0.4, -7.2);
  const prop = new THREE.Group(); prop.position.set(0, 0, 9.4); g.add(prop);
  add(BOX, M.dark, 4, 0.15, 0.35, 0, 0, 0, prop);

  let pz = z, active = false;
  const phase = rand() * 6;
  const place = (t) => {
    const px = terrain.centerX(pz) + offsetX + Math.sin(t * 0.5 + phase) * 6;
    g.position.set(px, terrain.base(pz) + 12 + alt, pz);
    g.rotation.z = Math.cos(t * 0.5 + phase) * 0.15;
  };
  place(0);
  return {
    kind: 'plane', object: g, span: 25,
    getZ: () => pz,
    update(dt, t, focus) {
      if (!active && focus && focus.z > pz && focus.z - pz < 650) active = true;
      if (active) pz += 42 * dt;
      place(t);
      prop.rotation.z += dt * 40;
    },
    hit(p, r) {
      const lx = p.x - g.position.x, ly = p.y - g.position.y, lz = p.z - g.position.z;
      if (Math.abs(lx) < 1.4 + r && Math.abs(ly) < 1.4 + r && Math.abs(lz) < 9 + r) return 'Flugzeug';
      if (Math.abs(lx) < 10 + r && Math.abs(ly) < 0.4 + r && Math.abs(lz - 1) < 1.8 + r) return 'Flugzeugflügel';
      if (lz < -5.5 && lz > -8.5 && ly > 0 && ly < 3.4 + r && Math.abs(lx) < 0.4 + r) return 'Leitwerk';
      return null;
    },
  };
}
