import * as THREE from 'three';

export const CHUNK_LEN = 160;
const X_MIN = -300, X_MAX = 300;
const X_SEGS = 80, Z_SEGS = 32;

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  const top = a + (b - a) * u, bot = c + (d - c) * u;
  return top + (bot - top) * v;
}

export function fbm(x, z, seed, oct = 4) {
  let s = 0, amp = 1, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += amp * (vnoise(x * f, z * f, seed + i * 17) * 2 - 1);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return s / norm;
}

export class Terrain {
  constructor(seed) {
    this.seed = seed | 0;
    this.phase = (this.seed % 1000) * 0.01;
  }
  centerX(z) {
    return 55 * Math.sin(z * 0.0021 + this.phase) + 22 * Math.sin(z * 0.0059 + 1.3);
  }
  base(z) {
    return 0.38 * z + 40 * fbm(z * 0.0016, 0.5, this.seed + 5, 3);
  }
  shape(x, z) {
    const dx = x - this.centerX(z);
    const adx = Math.abs(dx);
    let s = 0.0105 * dx * dx;
    s += fbm(x * 0.012, z * 0.012, this.seed, 4) * (5 + adx * 0.35);
    s += Math.max(0, fbm(x * 0.03, z * 0.03, this.seed + 99, 2)) * 7;
    return s;
  }
  height(x, z) {
    return this.base(z) + this.shape(x, z);
  }
}

const C = {
  meadow: new THREE.Color('#587a37'),
  meadow2: new THREE.Color('#7c9a48'),
  rock: new THREE.Color('#867d73'),
  rockDark: new THREE.Color('#5c554f'),
  snow: new THREE.Color('#f1f5fa'),
};

export const TERRAIN_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0,
});

export function buildChunkGeometry(terrain, index) {
  const z0 = -index * CHUNK_LEN;
  const cols = X_SEGS + 1, rows = Z_SEGS + 1;
  const dxStep = (X_MAX - X_MIN) / X_SEGS, dzStep = CHUNK_LEN / Z_SEGS;
  const pos = new Float32Array(cols * rows * 3);
  const col = new Float32Array(cols * rows * 3);
  const shapes = new Float32Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    const z = z0 - r * dzStep;
    const b = terrain.base(z);
    for (let c = 0; c < cols; c++) {
      const x = X_MIN + c * dxStep;
      const s = terrain.shape(x, z);
      const i = r * cols + c;
      pos[i * 3] = x; pos[i * 3 + 1] = b + s; pos[i * 3 + 2] = z;
      shapes[i] = s;
    }
  }

  const tmp = new THREE.Color();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = pos[i * 3], z = pos[i * 3 + 2], s = shapes[i];
      const l = shapes[r * cols + Math.max(c - 1, 0)], rr = shapes[r * cols + Math.min(c + 1, cols - 1)];
      const slope = Math.abs(rr - l) / (2 * dxStep);
      const n = fbm(x * 0.05, z * 0.05, terrain.seed + 31, 2);
      const rockiness = THREE.MathUtils.clamp((s - 14) / 35 + slope * 0.8 + n * 0.15, 0, 1);
      tmp.copy(C.meadow).lerp(C.meadow2, n * 0.5 + 0.5).lerp(C.rock, rockiness);
      if (rockiness > 0.8 && n < -0.15) tmp.lerp(C.rockDark, 0.5);
      const snowLine = 72 + n * 18;
      if (s > snowLine) tmp.lerp(C.snow, THREE.MathUtils.clamp((s - snowLine) / 14, 0, 1));
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
  }

  const idx = [];
  for (let r = 0; r < Z_SEGS; r++) {
    for (let c = 0; c < X_SEGS; c++) {
      const a = r * cols + c, b = a + 1, cc = a + cols, d = cc + 1;
      idx.push(a, b, cc, b, d, cc);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}
