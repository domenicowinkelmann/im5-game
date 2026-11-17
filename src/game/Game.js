import * as THREE from 'three';
import { World } from './World.js';
import { Player } from './Player.js';
import { Input } from './Input.js';
import { audio } from './audio.js';
import { api } from '../api/index.js';
import { collectContext } from '../api/context.js';
import { showRewardedAd, showInterstitial } from '../ads/adHooks.js';
import { COIN_TYPES, MULTIPLIER, TUNNEL_BONUS, STYLE_PER_SECOND, ACCOUNT, ADS } from '../shared/economy.js';

const HORIZON = new THREE.Color('#a9cbed');
const clamp = THREE.MathUtils.clamp;
const ENGAGE_TIMEOUT_MS = 2500;

function makeSky() {
  const geo = new THREE.SphereGeometry(1400, 32, 16);
  const top = new THREE.Color('#2f78cf'), bottom = new THREE.Color('#dce8f3');
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 1400;
    if (y > 0) c.copy(HORIZON).lerp(top, Math.pow(y, 0.55));
    else c.copy(HORIZON).lerp(bottom, Math.min(1, -y * 3));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  mesh.renderOrder = -1;
  return mesh;
}

export class Game {
  constructor(canvas, ui) {
    this.ui = ui;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = HORIZON;
    this.scene.fog = new THREE.Fog(HORIZON, 220, 880);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.5, 1800);

    this.scene.add(new THREE.HemisphereLight('#dbeaff', '#5a4b3a', 1.1));
    const sun = new THREE.DirectionalLight('#fff1d8', 2.4);
    sun.position.set(-60, 100, 35);
    this.scene.add(sun);
    this.sky = makeSky();
    this.scene.add(this.sky);

    this.world = new World(this.scene);
    this.player = new Player(this.scene);
    this.input = new Input(canvas);

    this.state = 'menu';
    this.leaving = false;
    this.menuEngaged = false;
    this.lastNewHighscore = false;
    this.adAwaitingPlay = null;
    this.consentPending = null;
    this.sessionUser = null;
    this.clock = new THREE.Clock();
    this.t = 0;
    this.menuPos = new THREE.Vector3();
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.shake = 0;
    this.debris = [];
    this._v = new THREE.Vector3();
    this._f = new THREE.Vector3();

    window.addEventListener('resize', () => this.resize());
    this.resize();

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' && e.code !== 'Enter') return;
      if (this.state !== 'dead' || this.ui.current !== 'gameover' || this.ui.blocked || this.leaving) return;
      if (e.target instanceof HTMLButtonElement && e.target.id !== 'btn-retry') return;
      e.preventDefault();
      this.leaveGameOver('retry');
    });
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  newSeed() { return (Math.random() * 1e9) | 0; }

  async init() {
    this.world.reset(this.newSeed());
    this.player.group.visible = false;
    this.menuPos.set(0, 0, 0);
    this.ui.showScreen('menu');
    this.renderer.setAnimationLoop(() => this.frame());
    await this.loadProfile();
  }

  async loadProfile() {
    this.ui.setConnection('loading');
    try {
      this.applyProfile(await api.getMe());
      this.ui.setConnection('ok');
    } catch (e) {
      this.ui.setConnection('error', e.message);
      return;
    }
    await this.ensureConsent();
    this.engageMenu();
  }

  ensureConsent() {
    if (this.consentPending) return this.consentPending;
    this.consentPending = (async () => {
      await this.ui.modalsClosed();
      const consent = this.profile?.consent;
      if (consent && !consent.decided) await this.ui.askConsent(consent);
      this.startSession();
    })().finally(() => { this.consentPending = null; });
    return this.consentPending;
  }

  startSession(force = false) {
    const p = this.profile;
    if (!p?.consent?.stats || (!force && this.sessionUser === p.userId)) return;
    this.sessionUser = p.userId;
    api.startSession(collectContext());
  }

  applyProfile(p) {
    this.profile = p;
    this.ui.setProfile(p);
    this.player.setLoadout(p.equipped);
    this.showSessionNotice();
  }

  showSessionNotice() {
    if (!api.takeSessionNotice()?.wasGuest) return false;
    const hours = ACCOUNT.guestRetentionHours;
    this.ui.showNotice(`Dein Gast-Spielstand wurde gelöscht, weil du länger als ${hours} Stunden nicht gespielt hast. ` +
      'Du startest mit einem neuen Spielstand. Registriere dich, damit dein Fortschritt gesichert bleibt.');
    this.ensureConsent();
    return true;
  }

  async checkSession() {
    if (!this.showSessionNotice()) return;
    try { this.applyProfile(await api.getMe()); } catch (e) {}
  }

  async engage(placement, facts = {}) {
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ENGAGE_TIMEOUT_MS); });
    const request = api.engage(placement, { hour: new Date().getHours(), newHighscore: false, newItem: false, ...facts })
      .catch(() => null);
    const d = await Promise.race([request, timeout]);
    clearTimeout(timer);
    if (d === null) request.then((late) => this.dropUnshown(late));
    return d;
  }

  dropUnshown(d, shown = null) {
    for (const entry of [d?.interstitial, d?.nudge]) {
      if (entry && entry !== shown) api.engageOutcome(entry.id, 'dropped');
    }
  }

  inMenu() {
    return this.state === 'menu' && this.ui.current === 'menu' && !this.ui.blocked;
  }

  async engageMenu() {
    if (this.menuEngaged || !this.inMenu()) return;
    this.menuEngaged = true;
    const d = await this.engage('menu');
    const nudge = this.inMenu() ? d?.nudge : null;
    this.dropUnshown(d, nudge);
    if (nudge && await this.ui.showNudge(nudge) === 'clicked') this.ui.openAccount('signup');
  }

  async slotNudge() {
    const d = await this.engage('slot_item', { newItem: true });
    const nudge = !this.ui.blocked && this.ui.current === 'slots' ? d?.nudge : null;
    this.dropUnshown(d, nudge);
    return !!nudge && await this.ui.showNudge(nudge) === 'clicked';
  }

  async leaveGameOver(next) {
    if (this.leaving || this.state !== 'dead' || this.ui.blocked) return;
    this.leaving = true;
    let signup = false;
    try {
      const d = await this.engage('gameover', { newHighscore: this.lastNewHighscore });
      const shown = d?.interstitial ?? d?.nudge ?? null;
      this.dropUnshown(d, shown);
      if (d?.interstitial) {
        await showInterstitial(this.ui, d.interstitial);
        this.adAwaitingPlay = { id: d.interstitial.id, until: performance.now() + ADS.interstitial.continueSeconds * 1000 };
      } else if (d?.nudge) {
        signup = await this.ui.showNudge(d.nudge) === 'clicked';
      }
    } finally {
      this.leaving = false;
    }
    if (signup) {
      this.toMenu();
      this.ui.openAccount('signup');
    } else if (next === 'retry') {
      this.startRun();
    } else {
      this.toMenu();
      if (next === 'slots') this.ui.openSlots();
    }
  }

  startRun() {
    if (!this.profile) return;
    audio.ensure();
    this.clearDebris();
    this.world.reset(this.newSeed());
    this.player.reset(this.world.terrain);
    this.run = {
      time: 0, distance: 0, coins: 0, style: 0, tunnels: 0,
      mult: 1, maxMult: 1, nearTime: 0, farTime: 0,
      coinsByType: { bronze: 0, silver: 0, gold: 0, diamond: 0 },
      cause: '',
      afterAd: this.adAwaitingPlay && performance.now() <= this.adAwaitingPlay.until ? this.adAwaitingPlay.id : null,
    };
    this.adAwaitingPlay = null;
    this.lastRunId = null;
    this.lastNewHighscore = false;
    this.state = 'playing';
    this.ui.showScreen('hud');
    this.ui.showHint();
    this.snapCamera();
    api.trackEvent('run_start');
  }

  score() {
    const r = this.run;
    return Math.floor(r.distance + r.style + r.tunnels * TUNNEL_BONUS);
  }

  crash(cause) {
    if (this.state !== 'playing') return;
    this.state = 'crashing';
    this.crashTimer = 1.1;
    this.run.cause = cause;
    this.player.group.visible = false;
    this.spawnDebris();
    this.shake = 1;
    audio.crash();
    audio.setWind(0);
    this.ui.flash();
    this.ui.setVignette(0);
  }

  async endRun() {
    const r = this.run;
    const payload = {
      distance: Math.floor(r.distance),
      score: this.score(),
      coins: r.coins,
      duration: +r.time.toFixed(2),
      maxMultiplier: r.maxMult,
      tunnels: r.tunnels,
      cause: r.cause,
      coinsByType: r.coinsByType,
    };
    let res = null, error = null;
    try { res = await api.submitRun(payload); } catch (e) { error = e.message; }
    if (res) {
      this.lastRunId = res.runId;
      this.lastNewHighscore = !!res.newHighscore;
      this.applyProfile(res.profile);
    }
    if (r.afterAd) api.engageOutcome(r.afterAd, 'continued');
    await this.checkSession();
    api.trackEvent('run_end', { accepted: !!res, duration: payload.duration, distance: payload.distance, cause: payload.cause });
    this.state = 'dead';
    this.ui.showGameOver(payload, res, error);
  }

  async doubleCoins() {
    const runId = this.lastRunId;
    if (!runId || this.leaving) return;
    api.trackEvent('rewarded_ad_start', { placement: 'double_coins' });
    const watched = await showRewardedAd(this.ui);
    if (!watched) return;
    try {
      const res = await api.claimDouble(runId);
      this.applyProfile(res.profile);
      this.ui.markDoubled(res.profile);
      api.trackEvent('rewarded_ad_complete', { placement: 'double_coins' });
    } catch (e) { this.ui.doubleFailed(e.message); }
    await this.checkSession();
  }

  toMenu() {
    this.state = 'menu';
    this.player.group.visible = false;
    this.player.trails.forEach((t) => t.reset());
    this.menuPos.copy(this.player.pos);
    this.ui.showScreen('menu');
    audio.setWind(0);
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    this.t += dt;
    if (this.state === 'playing') this.updatePlaying(dt);
    else if (this.state === 'menu') this.updateMenu(dt);
    else {
      if (this.state === 'crashing') {
        this.crashTimer -= dt;
        if (this.crashTimer <= 0) { this.state = 'ending'; this.endRun(); }
      }
      this.world.update(dt, this.t, this.player.pos);
      this.player.updateTrails(this.t);
    }
    this.updateDebris(dt);
    this.updateCamera(dt);
    this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  updatePlaying(dt) {
    const p = this.player, r = this.run;
    p.update(dt, this.input.update(dt), this.world.terrain, this.t);
    this.world.update(dt, this.t, p.pos);
    r.time += dt;
    r.distance = Math.max(r.distance, -p.pos.z);

    if (p.clearance < 0.7) return this.crash('Bodenkontakt');
    const cause = this.world.checkHit(p.pos, 0.9);
    if (cause) return this.crash(cause);

    const arch = this.world.archState(p.pos);
    if (arch.passed > 0) {
      r.tunnels += arch.passed;
      this.ui.banner(`TUNNEL! +${TUNNEL_BONUS}`, 'gold');
      audio.bonus();
    }

    const near = p.clearance < MULTIPLIER.nearDistance || arch.inside;
    if (near) {
      r.nearTime += dt;
      r.farTime = 0;
      r.style += dt * STYLE_PER_SECOND * r.mult;
      if (r.nearTime >= MULTIPLIER.stepSeconds) {
        r.nearTime -= MULTIPLIER.stepSeconds;
        if (r.mult < MULTIPLIER.max) {
          r.mult++;
          r.maxMult = Math.max(r.maxMult, r.mult);
          this.ui.banner(`x${r.mult}`, 'mult');
          audio.bonus();
        } else r.nearTime = MULTIPLIER.stepSeconds;
      }
    } else {
      r.nearTime = Math.max(0, r.nearTime - dt * 0.5);
      if (p.clearance > MULTIPLIER.resetDistance) {
        r.farTime += dt;
        if (r.farTime > MULTIPLIER.resetSeconds && r.mult > 1) {
          r.mult = 1; r.nearTime = 0;
          this.ui.banner('Multiplikator weg', 'lost');
          audio.lost();
        }
      } else r.farTime = 0;
    }

    this.world.collect(p.pos, (coin) => {
      const v = COIN_TYPES[coin.type].value * r.mult;
      r.coins += v;
      r.coinsByType[coin.type]++;
      const s = this.toScreen(coin.mesh.position);
      this.ui.popup(`+${v}`, s.x, s.y, coin.type);
      audio.coin(coin.type, r.mult);
    });

    audio.setWind(clamp((p.speed - 15) / 70, 0, 1) * (p.clearance < 12 ? 1.25 : 1));
    this.ui.updateHud({
      distance: r.distance, coins: r.coins, score: this.score(), speed: p.speed,
      mult: r.mult, multProgress: r.mult >= MULTIPLIER.max ? 1 : r.nearTime / MULTIPLIER.stepSeconds,
      near: near ? clamp(1 - p.clearance / MULTIPLIER.nearDistance, 0.25, 1) : 0,
    });
  }

  updateMenu(dt) {
    const T = this.world.terrain;
    this.menuPos.z -= 22 * dt;
    this.menuPos.x = T.centerX(this.menuPos.z);
    this.menuPos.y = T.base(this.menuPos.z) + 50;
    this.world.update(dt, this.t, this.menuPos);
  }

  snapCamera() {
    this.desiredCam(this.camPos, this.camLook);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  desiredCam(pos, look) {
    const T = this.world.terrain;
    if (this.state === 'menu') {
      const z = this.menuPos.z, az = z - 90;
      pos.copy(this.menuPos);
      look.set(T.centerX(az), T.base(az) + 22, az);
      return;
    }
    const p = this.player;
    const f = p.forwardH(this._camF || (this._camF = new THREE.Vector3()));
    pos.copy(p.pos).addScaledVector(f, -9.5);
    pos.y += 3.4 - p.pitch * 3;
    const ground = T.height(pos.x, pos.z) + 2.5;
    if (pos.y < ground) pos.y = ground;
    look.copy(p.pos).addScaledVector(f, 14);
    look.y += -1 + p.pitch * 6;
  }

  updateCamera(dt) {
    const k = 1 - Math.exp(-dt * (this.state === 'menu' ? 2 : 7));
    const look = this._lookTarget || (this._lookTarget = new THREE.Vector3());
    this.desiredCam(this._v, look);
    this.camPos.lerp(this._v, k);
    this.camLook.lerp(look, k);

    this.shake = Math.max(0, this.shake - dt * 1.8);
    let s = this.shake * 0.9;
    if (this.state === 'playing' && this.player.clearance < 6) s += 0.06 * (this.player.speed / 60);
    this.camera.position.set(
      this.camPos.x + (Math.random() - 0.5) * s,
      this.camPos.y + (Math.random() - 0.5) * s,
      this.camPos.z + (Math.random() - 0.5) * s,
    );
    this.camera.lookAt(this.camLook);
    if (this.state === 'playing') this.camera.rotateZ(this.player.roll * 0.25);

    const fov = this.state === 'menu' ? 62 : clamp(64 + (this.player.speed - 30) * 0.45, 62, 92);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 3);
      this.camera.updateProjectionMatrix();
    }
  }

  toScreen(v) {
    const p = this._v.copy(v).project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight };
  }

  spawnDebris() {
    const p = this.player;
    const f = p.forwardH(new THREE.Vector3());
    const geo = new THREE.BoxGeometry(0.35, 0.35, 0.35);
    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(geo, i % 3 ? p.suitMat : p.accentMat);
      m.position.copy(p.pos);
      const v = f.clone().multiplyScalar(p.speed * 0.3).add(new THREE.Vector3(
        (Math.random() - 0.5) * 14, Math.random() * 10, (Math.random() - 0.5) * 14));
      this.scene.add(m);
      this.debris.push({ m, v });
    }
  }

  updateDebris(dt) {
    if (!this.debris.length) return;
    const T = this.world.terrain;
    for (const d of this.debris) {
      d.v.y -= 20 * dt;
      d.m.position.addScaledVector(d.v, dt);
      d.m.rotation.x += dt * 5; d.m.rotation.y += dt * 4;
      const g = T.height(d.m.position.x, d.m.position.z) + 0.2;
      if (d.m.position.y < g) { d.m.position.y = g; d.v.multiplyScalar(0.3); d.v.y = Math.abs(d.v.y); }
    }
  }

  clearDebris() {
    for (const d of this.debris) this.scene.remove(d.m);
    this.debris = [];
  }
}
