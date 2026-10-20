import * as THREE from 'three';
import { Terrain, buildChunkGeometry, CHUNK_LEN, TERRAIN_MATERIAL, mulberry32 } from './terrain.js';
import * as E from './entities.js';

const AHEAD = 6;
const BEHIND = 1;

export class World {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();
    this.entities = [];
    this.coins = [];
    this.terrain = new Terrain(1);
    this.seed = 1;
  }

  reset(seed) {
    for (const i of [...this.chunks.keys()]) this.removeChunk(i);
    this.entities = [];
    this.coins = [];
    this.seed = seed;
    this.terrain = new Terrain(seed);
  }

  ensure(z) {
    const ci = Math.floor(-z / CHUNK_LEN);
    for (let i = ci - BEHIND; i <= ci + AHEAD; i++) if (!this.chunks.has(i)) this.addChunk(i);
    for (const i of [...this.chunks.keys()]) {
      if (i < ci - BEHIND - 1 || i > ci + AHEAD + 1) this.removeChunk(i);
    }
  }

  addChunk(i) {
    const mesh = new THREE.Mesh(buildChunkGeometry(this.terrain, i), TERRAIN_MATERIAL);
    this.scene.add(mesh);
    const chunk = { index: i, mesh, entities: [], coins: [] };
    this.chunks.set(i, chunk);
    if (i >= 0) this.populate(chunk);
  }

  removeChunk(i) {
    const c = this.chunks.get(i);
    if (!c) return;
    this.scene.remove(c.mesh);
    c.mesh.geometry.dispose();
    for (const e of c.entities) this.scene.remove(e.object);
    for (const k of c.coins) this.scene.remove(k.mesh);
    this.entities = this.entities.filter((e) => e.chunk !== i);
    this.coins = this.coins.filter((k) => k.chunk !== i);
    this.chunks.delete(i);
  }

  addEntity(chunk, e) {
    e.chunk = chunk.index;
    chunk.entities.push(e);
    this.entities.push(e);
    this.scene.add(e.object);
  }

  addCoin(chunk, type, x, y, z) {
    const c = E.createCoin(type, x, y, z);
    c.chunk = chunk.index;
    chunk.coins.push(c);
    this.coins.push(c);
    this.scene.add(c.mesh);
  }

  coinLine(chunk, type, z, n, spacing, alt, xOff, clear) {
    const T = this.terrain;
    for (let k = 0; k < n; k++) {
      const zz = z - k * spacing;
      const xx = T.centerX(zz) + xOff + Math.sin(k * 0.6) * 3;
      this.addCoin(chunk, type, xx, T.height(xx, zz) + alt, zz);
      clear.push({ x: xx, z: zz, rad: 9 });
    }
  }

  populate(chunk) {
    const T = this.terrain;
    const i = chunk.index;
    const r = mulberry32(this.seed * 31 + i * 7919);
    const d = Math.min(1, i / 30);
    const zTop = -i * CHUNK_LEN;
    const third = CHUNK_LEN / 3;
    const slots = [0, 1, 2].sort(() => r() - 0.5);
    const slotZ = (s) => zTop - s * third - third * (0.15 + r() * 0.5);
    const clear = [];

    this.coinLine(chunk, 'bronze', slotZ(slots[0]), 8, 7, 22 + r() * 14, (r() * 2 - 1) * 25, clear);

    if (i >= 1 && r() < 0.55 + 0.25 * d) {
      const z = slotZ(slots[1]);
      const x0 = T.centerX(z) + (r() * 2 - 1) * 12;
      const gap = 18 - 5 * d + r() * 2;
      const openH = 15 - 3 * d + r() * 3;
      const depth = r() < 0.4 ? 18 + r() * 18 : 7 + r() * 5;
      const { entity, spots } = E.createArch(T, z, x0, gap, openH, depth, r);
      this.addEntity(chunk, entity);
      for (const s of spots) this.addCoin(chunk, s.type, s.x, s.y, s.z);
      clear.push({ x: x0, z, rad: gap + depth });
    } else if (r() < 0.5) {
      this.coinLine(chunk, 'bronze', slotZ(slots[1]), 6, 7, 14 + r() * 10, (r() * 2 - 1) * 30, clear);
    }

    if (r() < 0.85) {
      const n = 6;
      const z = slotZ(slots[2]);
      const xOff = (r() * 2 - 1) * 18;
      this.coinLine(chunk, 'silver', z, n, 6, 3.4 + r() * 1.4, xOff, clear);
      if (r() < 0.08) {
        const zz = z - n * 6;
        const xx = T.centerX(zz) + xOff;
        this.addCoin(chunk, 'diamond', xx, T.height(xx, zz) + 3.6, zz);
      }
    }

    const trees = [];
    const nTrees = 14 + Math.floor(r() * 12);
    for (let k = 0; k < nTrees * 3 && trees.length < nTrees; k++) {
      const z = zTop - r() * CHUNK_LEN;
      const x = T.centerX(z) + (r() * 2 - 1) * 75;
      if (T.shape(x, z) > 30) continue;
      if (clear.some((c) => (c.x - x) ** 2 + (c.z - z) ** 2 < c.rad * c.rad)) continue;
      const s = 0.8 + r() * 0.9;
      trees.push({ x, z, y: T.height(x, z), r: 2.6 * s, h: 9 * s });
    }
    if (trees.length) this.addEntity(chunk, E.createTrees(trees, zTop - CHUNK_LEN / 2));

    if (i >= 1 && r() < 0.3 + 0.35 * d) {
      const z = zTop - r() * CHUNK_LEN;
      const x = T.centerX(z) + (r() * 2 - 1) * 20;
      this.addEntity(chunk, E.createBirdFlock(T, x, z, 8 + r() * 22, 5 + Math.floor(r() * 5), r));
    }
    if (i >= 2 && r() < 0.12 + 0.3 * d) {
      const z = zTop - r() * CHUNK_LEN;
      const x = T.centerX(z) + (r() * 2 - 1) * 25;
      this.addEntity(chunk, E.createHelicopter(x, T.height(x, z) + 18 + r() * 22, z, r));
    }
    if (i >= 3 && r() < 0.08 + 0.25 * d) {
      this.addEntity(chunk, E.createPlane(T, (r() * 2 - 1) * 15, zTop - CHUNK_LEN * 0.5, 22 + r() * 25, r));
    }
  }

  update(dt, t, focus) {
    this.ensure(focus.z);
    for (const e of this.entities) if (e.update) e.update(dt, t, focus);
    for (const c of this.coins) if (!c.collected) c.mesh.rotation.y += dt * 2.5;
  }

  checkHit(p, r) {
    for (const e of this.entities) {
      if (!e.hit || Math.abs(e.getZ() - p.z) > e.span + 20) continue;
      const cause = e.hit(p, r);
      if (cause) return cause;
    }
    return null;
  }

  collect(p, onCollect) {
    for (const c of this.coins) {
      if (c.collected || Math.abs(c.mesh.position.z - p.z) > 8) continue;
      if (c.mesh.position.distanceToSquared(p) < c.radius * c.radius) {
        c.collected = true;
        this.scene.remove(c.mesh);
        onCollect(c);
      }
    }
  }

  archState(p) {
    let inside = false, passed = 0;
    for (const e of this.entities) {
      if (e.kind !== 'arch' || Math.abs(e.getZ() - p.z) > 60) continue;
      if (e.inside(p)) { e.wasInside = true; inside = true; }
      else if (e.wasInside && !e.passed && p.z < e.opening.zBack) { e.passed = true; passed++; }
    }
    return { inside, passed };
  }
}
