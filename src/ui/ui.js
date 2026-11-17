import { ITEMS, getItem, itemsByCategory, CATEGORIES } from '../shared/items.js';
import { RARITIES, RARITY_ORDER, SPIN_COST, ALL_SYMBOLS, START_COINS, ACCOUNT, SLOT, PRIVACY } from '../shared/economy.js';
import { api } from '../api/index.js';
import { audio } from '../game/audio.js';
import { privacyHtml } from './privacy.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['menu', 'hud', 'gameover', 'slots', 'garage', 'account'];
const DEFAULT_ITEM_COUNT = ITEMS.filter((i) => i.default).length;
const fmt = (n) => Math.floor(n).toLocaleString('de-CH');
const randomSymbol = () => ALL_SYMBOLS[Math.floor(Math.random() * ALL_SYMBOLS.length)];
const rand = (a, b) => a + Math.random() * (b - a);
const isTyping = (el) => el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
const SPIN_MS = { base: 1100, step: 480, tension: 1800, perSymbol: 55 };
const BULBS = 22;
const LOSE_LINES = ['Leider nichts.', 'Niete – nochmal?', 'Knapp daneben ist auch vorbei.', 'Diesmal nicht.'];
const CONFETTI = { common: 16, rare: 26, epic: 40, legendary: 70 };
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]';
const AD_TEXT = {
  rewarded: { title: 'Werbung läuft …', note: 'Platzhalter – hier kommt später das Rewarded Ad' },
  interstitial: { title: 'Kurze Werbepause …', note: 'Platzhalter – hier kommt später das Interstitial Ad' },
};
const NUDGE_TEXT = {
  item: 'Glückwunsch zum neuen Item!',
  highscore: 'Neuer Highscore, stark geflogen!',
  return: 'Schön, dass du wieder da bist!',
  progress: 'Du hast schon einiges erspielt.',
};
const nudgeText = (reason) => `${NUDGE_TEXT[reason] ?? NUDGE_TEXT.progress} Als Gast wird dein Spielstand mit Münzen und Items ` +
  `nach ${ACCOUNT.guestRetentionHours} Stunden ohne Spiel gelöscht. Registriere dich, um ihn zu sichern.`;

export function swatch(item, big = false) {
  let bg;
  if (item.category === 'suit') bg = `linear-gradient(135deg, ${item.color} 0 62%, ${item.accent || '#1d2633'} 62% 100%)`;
  else if (item.rainbow) bg = 'linear-gradient(90deg,#ff4d6d,#ffb020,#ffe14d,#4dff88,#4dc3ff,#9b5cff)';
  else bg = `linear-gradient(90deg, ${item.color}, ${item.color2 || item.color})`;
  const cls = ['swatch', item.category, big ? 'big' : '', item.metal ? 'metal' : '', item.glow ? 'glow' : ''].join(' ');
  return `<span class="${cls}" style="background:${bg};--sw:${item.color}"></span>`;
}

export class UI {
  constructor() {
    this.current = 'menu';
    this.profile = null;
    this.garageCat = 'suit';
    this.spinning = false;
    this.lastMult = 1;
    this.accountMode = 'signup';
    this.accountBusy = false;
    this.modals = [];
    this.idleWaiters = [];
    this.consentDone = null;
    this.consentBusy = false;
    this.deleteBusy = false;
    this.nudgeDone = null;
    this.el = {
      vignette: $('vignette'), flash: $('flash'), popups: $('popups'), banner: $('banner'),
      dist: $('hud-dist'), coins: $('hud-coins'), score: $('hud-score'), speed: $('hud-speed'),
      mult: $('hud-mult'), multValue: $('hud-mult-value'), multFill: $('hud-mult-fill'), hint: $('hud-hint'),
    };
    $('spin-cost').textContent = SPIN_COST;
    $('account-guest-note').textContent =
      `Als Gast wird dein Spielstand nach ${ACCOUNT.guestRetentionHours} Stunden ohne Spiel gelöscht. Registriere dich, um ihn zu sichern.`;
    const age = PRIVACY.personalMinAge;
    $('consent-adult-label').textContent = `Ich bin ${age} Jahre oder älter`;
    $('consent-personal-desc').textContent =
      `Werbepausen und Hinweise passend zu deinem Spielverhalten. Nur mit Statistik und ab ${age} Jahren.`;
    $('privacy-text').innerHTML = privacyHtml();
    this.reelsMoving = false;
    this.reelState = [0, 1, 2].map(() => [randomSymbol(), randomSymbol(), randomSymbol()]);
    this.buildMachine();
  }

  bind(game) {
    this.game = game;
    $('btn-play').onclick = () => game.startRun();
    $('btn-retry').onclick = () => game.leaveGameOver('retry');
    $('btn-menu').onclick = () => game.leaveGameOver('menu');
    $('btn-slots').onclick = () => this.openSlots();
    $('btn-go-slots').onclick = () => game.leaveGameOver('slots');
    $('btn-garage').onclick = () => this.openGarage();
    $('btn-spin').onclick = () => this.spin();
    $('lever').onclick = () => this.spin();
    window.addEventListener('keydown', (e) => {
      if (this.current !== 'slots' || e.code !== 'Space' || e.repeat || this.blocked || isTyping(e.target)) return;
      e.preventDefault();
      this.spin();
    });
    document.addEventListener('keydown', (e) => this.modalKey(e));
    document.addEventListener('focusin', (e) => {
      const top = this.modals.at(-1);
      if (top && !top.element.contains(e.target)) this.focusModal(top.element);
    });
    window.addEventListener('resize', () => {
      if (this.current === 'slots' && !this.reelsMoving) this.layoutReels();
    });
    $('btn-double').onclick = () => { $('btn-double').disabled = true; game.doubleCoins(); };
    $('btn-account').onclick = () => this.openAccount();
    $('btn-notice-ok').onclick = () => this.closeNotice();
    $('btn-nudge-save').onclick = () => this.nudgeDone?.('clicked');
    $('btn-nudge-later').onclick = () => this.nudgeDone?.('dismissed');
    $('btn-reconnect').onclick = () => game.loadProfile();
    $('btn-logout').onclick = () => this.logout();
    $('account-form').onsubmit = (e) => { e.preventDefault(); this.submitAccount(); };
    $('btn-privacy').onclick = () => this.showPrivacy();
    $('btn-consent-privacy').onclick = () => this.showPrivacy();
    $('btn-privacy-close').onclick = () => this.closePrivacy();
    $('consent-stats').onchange = () => this.syncConsentSwitches();
    $('consent-adult').onchange = () => this.syncConsentSwitches();
    $('btn-consent-reject').onclick = () => this.saveConsent({ stats: false, personal: false });
    $('btn-consent-save').onclick = () => this.saveConsent({ stats: $('consent-stats').checked, personal: $('consent-personal').checked });
    $('btn-consent-all').onclick = () => this.saveConsent({ stats: true, personal: true });
    $('btn-consent-edit').onclick = () => this.askConsent(this.profile?.consent);
    $('btn-delete-open').onclick = () => this.openDelete();
    $('btn-delete-cancel').onclick = () => this.closeDelete();
    $('delete-form').onsubmit = (e) => { e.preventDefault(); this.deleteAccount(); };
    document.querySelectorAll('[data-back]').forEach((b) => { b.onclick = () => this.showScreen('menu'); });
    document.querySelectorAll('#garage .tab').forEach((t) => {
      t.onclick = () => {
        this.garageCat = t.dataset.cat;
        document.querySelectorAll('#garage .tab').forEach((x) => x.classList.toggle('active', x === t));
        this.renderGarage();
      };
    });
    document.querySelectorAll('#account .tab').forEach((t) => {
      t.onclick = () => this.setAccountMode(t.dataset.mode);
    });
    document.addEventListener('pointerdown', () => audio.ensure(), { once: true });
    document.addEventListener('keydown', () => audio.ensure(), { once: true });
  }

  showScreen(name) {
    for (const s of SCREENS) $(s).classList.toggle('hidden', s !== name);
    this.current = name;
    if (name !== 'hud') {
      this.setVignette(0);
      api.trackEvent('screen_view', { screen: name });
    }
  }

  setConnection(state, message = '') {
    const ready = state === 'ok';
    for (const id of ['btn-play', 'btn-slots', 'btn-garage', 'btn-account']) $(id).disabled = !ready;
    $('menu-error').textContent = state === 'error' ? message : '';
    $('menu-error').classList.toggle('hidden', state !== 'error');
    $('btn-reconnect').classList.toggle('hidden', state !== 'error');
  }

  setProfile(p) {
    this.profile = p;
    $('menu-user').textContent = p.username || 'Gast';
    $('menu-coins').textContent = fmt(p.coins);
    $('menu-best').textContent = fmt(p.highscore);
    $('slot-badge').classList.toggle('hidden', p.coins < SPIN_COST);
    if (!this.spinning) {
      $('slot-coins').textContent = fmt(p.coins);
      this.setSlotControls(true);
    }
  }

  showHint() {
    const h = this.el.hint;
    h.classList.remove('fade');
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => h.classList.add('fade'), 4500);
  }

  updateHud(h) {
    this.el.dist.textContent = fmt(h.distance) + ' m';
    this.el.coins.textContent = fmt(h.coins);
    this.el.score.textContent = fmt(h.score);
    this.el.speed.textContent = Math.round(h.speed * 3.6);
    this.el.multValue.textContent = 'x' + h.mult;
    this.el.multFill.style.transform = `scaleX(${Math.min(1, h.multProgress)})`;
    this.el.mult.dataset.level = h.mult;
    if (h.mult !== this.lastMult) {
      this.el.mult.classList.remove('bump'); void this.el.mult.offsetWidth; this.el.mult.classList.add('bump');
      this.lastMult = h.mult;
    }
    this.setVignette(h.near);
  }

  setVignette(v) { this.el.vignette.style.opacity = v; }

  popup(text, x, y, cls = '') {
    const d = document.createElement('div');
    d.className = 'popup ' + cls;
    d.textContent = text;
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    this.el.popups.appendChild(d);
    setTimeout(() => d.remove(), 900);
  }

  banner(text, cls = '') {
    const b = this.el.banner;
    b.className = '';
    b.textContent = text;
    void b.offsetWidth;
    b.className = 'show ' + cls;
  }

  flash() {
    const f = this.el.flash;
    f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
  }

  showGameOver(run, res, error) {
    $('go-newbest').classList.toggle('hidden', !res?.newHighscore);
    $('go-error').textContent = error || '';
    $('go-error').classList.toggle('hidden', !error);
    $('go-cause').textContent = run.cause || '';
    $('go-dist').textContent = fmt(run.distance) + ' m';
    $('go-score').textContent = fmt(run.score);
    $('go-coins').textContent = '+' + fmt(run.coins);
    $('go-mult').textContent = 'x' + run.maxMultiplier;
    const dbl = $('btn-double');
    dbl.classList.toggle('hidden', !res || run.coins <= 0);
    dbl.disabled = false;
    dbl.innerHTML = `▶ +${fmt(run.coins)} Münzen extra <small>Werbung</small>`;
    $('btn-go-slots').classList.toggle('pulse', (res?.profile?.coins ?? 0) >= SPIN_COST);
    this.showScreen('gameover');
  }

  markDoubled() {
    const dbl = $('btn-double');
    dbl.disabled = true;
    dbl.innerHTML = 'Verdoppelt ✓';
    const c = $('go-coins');
    c.textContent = '+' + fmt(parseInt(c.textContent.replace(/\D/g, ''), 10) * 2);
  }

  doubleFailed(message) {
    const dbl = $('btn-double');
    dbl.disabled = true;
    dbl.textContent = message;
  }

  get blocked() { return this.modals.length > 0; }

  focusables(el) {
    return [...el.querySelectorAll(FOCUSABLE)]
      .filter((x) => x.tabIndex >= 0 && !x.matches(':disabled') && x.getClientRects().length > 0);
  }

  focusModal(el) {
    (this.focusables(el)[0] || el).focus({ preventScroll: true });
  }

  pushModal(element, { dismissable = false, onDismiss = null, focusDialog = false } = {}) {
    this.modals.push({ element, dismissable, onDismiss, restore: document.activeElement });
    element.style.zIndex = String(10 + this.modals.length);
    if (!element.hasAttribute('tabindex')) element.tabIndex = -1;
    element.classList.remove('hidden');
    if (focusDialog) element.focus({ preventScroll: true });
    else this.focusModal(element);
  }

  popModal() {
    const top = this.modals.pop();
    if (!top) return;
    top.element.classList.add('hidden');
    top.element.style.zIndex = '';
    if (top.restore instanceof HTMLElement) top.restore.focus({ preventScroll: true });
    const next = this.modals.at(-1);
    if (next && !next.element.contains(document.activeElement)) this.focusModal(next.element);
    else if (top.element.contains(document.activeElement)) document.activeElement.blur();
    if (!this.modals.length) this.idleWaiters.splice(0).forEach((resolve) => resolve());
  }

  closeModal(element) {
    if (this.modals.at(-1)?.element === element) return this.popModal();
    const i = this.modals.findIndex((m) => m.element === element);
    if (i < 0) return;
    this.modals.splice(i, 1);
    element.classList.add('hidden');
    element.style.zIndex = '';
  }

  modalsClosed() {
    if (!this.modals.length) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  isOpen(id) {
    return this.modals.some((m) => m.element === $(id));
  }

  showPrivacy() {
    if (this.isOpen('privacy')) return;
    $('privacy-text').scrollTop = 0;
    this.pushModal($('privacy'), { dismissable: true });
  }

  closePrivacy() {
    if (this.modals.at(-1)?.element === $('privacy')) this.popModal();
  }

  syncConsentSwitches() {
    const allowed = $('consent-stats').checked && $('consent-adult').checked;
    const personal = $('consent-personal');
    personal.disabled = !allowed;
    if (!allowed) personal.checked = false;
  }

  askConsent(current) {
    if (this.consentDone) return this.consentDone.promise;
    const c = current?.decided ? current : { stats: false, personal: false, adult: current?.adult ?? false };
    $('consent-stats').checked = !!c.stats;
    $('consent-adult').checked = !!c.adult;
    $('consent-personal').checked = !!c.personal;
    $('consent-error').textContent = '';
    this.syncConsentSwitches();
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    this.consentDone = { promise, resolve };
    this.pushModal($('consent'));
    return promise;
  }

  async saveConsent({ stats, personal }) {
    if (this.consentBusy || !this.consentDone) return;
    const adult = $('consent-adult').checked;
    const buttons = ['btn-consent-reject', 'btn-consent-save', 'btn-consent-all'].map($);
    this.consentBusy = true;
    buttons.forEach((b) => { b.disabled = true; });
    $('consent-error').textContent = '';
    try {
      const res = await api.setConsent({ stats, personal: personal && stats && adult, adult });
      this.closeModal($('consent'));
      const done = this.consentDone;
      this.consentDone = null;
      const granted = !this.profile?.consent?.stats && res.profile.consent.stats;
      this.game.applyProfile(res.profile);
      if (granted) this.game.startSession(true);
      if (this.current === 'account') this.renderAccount();
      done.resolve(res.profile.consent);
    } catch (e) {
      $('consent-error').textContent = e.message;
    } finally {
      this.consentBusy = false;
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  modalKey(e) {
    const top = this.modals.at(-1);
    if (!top) return;
    if (e.key === 'Escape') {
      if (!top.dismissable) return;
      e.preventDefault();
      this.popModal();
      top.onDismiss?.();
      return;
    }
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const items = this.focusables(top.element);
    if (!items.length) return top.element.focus({ preventScroll: true });
    const i = items.indexOf(document.activeElement);
    const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length;
    items[next].focus({ preventScroll: true });
  }

  showNotice(text) {
    const el = $('notice');
    $('notice-text').textContent = text;
    if (!this.modals.some((m) => m.element === el)) this.pushModal(el, { dismissable: true });
  }

  closeNotice() {
    if (this.modals.at(-1)?.element === $('notice')) this.popModal();
  }

  showNudge(d) {
    const el = $('nudge');
    if (this.nudgeDone) {
      api.engageOutcome(d.id, 'dropped');
      return Promise.resolve('dropped');
    }
    $('nudge-text').textContent = nudgeText(d.reason);
    return new Promise((resolve) => {
      const finish = (outcome) => {
        if (this.nudgeDone !== finish) return;
        this.nudgeDone = null;
        this.closeModal(el);
        api.engageOutcome(d.id, outcome);
        resolve(outcome);
      };
      this.nudgeDone = finish;
      this.pushModal(el, { dismissable: true, focusDialog: true, onDismiss: () => finish('dismissed') });
    });
  }

  fakeAd(seconds, kind = 'rewarded') {
    return new Promise((resolve) => {
      const text = AD_TEXT[kind] ?? AD_TEXT.rewarded;
      let n = seconds;
      $('ad-title').textContent = text.title;
      $('ad-note').textContent = text.note;
      $('ad-count').textContent = n;
      this.pushModal($('ad-overlay'));
      const iv = setInterval(() => {
        n--;
        $('ad-count').textContent = Math.max(n, 0);
        if (n <= 0) { clearInterval(iv); this.popModal(); resolve(true); }
      }, 1000);
    });
  }

  slotMessage(text) {
    const d = document.createElement('div');
    d.className = 'prize muted';
    d.textContent = text;
    $('slot-result').replaceChildren(d);
  }

  buildMachine() {
    const bulbs = $('bulbs');
    for (let i = 0; i < BULBS; i++) {
      const t = (i / BULBS) * 4, side = Math.floor(t), f = (t % 1) * 100;
      const [x, y] = [[f, 0], [100, f], [100 - f, 100], [0, 100 - f]][side];
      const b = document.createElement('span');
      b.className = 'bulb';
      b.style.cssText = `left:${x}%;top:${y}%;--i:${i}`;
      bulbs.append(b);
    }
    const legend = [...RARITY_ORDER].reverse().map((r) => {
      const { symbol, label, color } = RARITIES[r];
      return `<span><b style="color:${color}">${symbol.repeat(3)}</b> ${label}</span>`;
    });
    legend.push(`<span><b>${SLOT.jackpot.symbol.repeat(3)}</b> Jackpot ${SLOT.jackpot.amount}</span>`);
    legend.push(`<span><b>2 Gleiche</b> ${SLOT.pair.min}–${SLOT.pair.max}</span>`);
    $('paytable').innerHTML = legend.join('');
  }

  renderStrip(strip, symbols) {
    strip.replaceChildren(...symbols.map((s) => {
      const d = document.createElement('div');
      d.className = 'sym';
      d.textContent = s;
      return d;
    }));
  }

  stripOffset(reel, strip, index) {
    const symH = strip.firstElementChild.offsetHeight;
    return (reel.clientHeight - symH) / 2 - index * symH;
  }

  layoutReels() {
    document.querySelectorAll('.reel').forEach((reel, i) => {
      const strip = reel.querySelector('.strip');
      this.renderStrip(strip, this.reelState[i]);
      strip.style.transition = 'none';
      strip.style.transform = `translateY(${this.stripOffset(reel, strip, 1)}px)`;
    });
  }

  setSlotControls(enabled) {
    const off = !enabled || !this.profile || this.profile.coins < SPIN_COST;
    $('btn-spin').disabled = off;
    $('lever').disabled = off;
  }

  resetMachineEffects() {
    $('machine').classList.remove('jackpot', 'win', 'lose', 'tense', 'spinning');
    document.querySelectorAll('.reel').forEach((r) => r.classList.remove('hit', 'stop', 'tense'));
    $('lever').classList.remove('pulled');
    $('slot-flash').className = 'slot-flash';
  }

  openSlots() {
    this.showScreen('slots');
    if (!this.spinning) {
      $('slot-result').innerHTML = '';
      this.resetMachineEffects();
    }
    if (!this.reelsMoving) this.layoutReels();
    this.setProfile(this.profile);
  }

  spinReel(reel, i, final, duration, tease) {
    const strip = reel.querySelector('.strip');
    const symbols = [...this.reelState[i]];
    const count = Math.max(8, Math.round(duration / SPIN_MS.perSymbol));
    for (let k = 0; k < count; k++) symbols.push(randomSymbol());
    const landing = [randomSymbol(), final, tease ?? randomSymbol()];
    symbols.push(...landing);
    this.renderStrip(strip, symbols);
    strip.style.transition = 'none';
    strip.style.transform = `translateY(${this.stripOffset(reel, strip, 1)}px)`;
    void strip.offsetHeight;
    strip.classList.add('blur');
    strip.style.transition = `transform ${duration}ms cubic-bezier(.15,.7,.25,1.05)`;
    strip.style.transform = `translateY(${this.stripOffset(reel, strip, symbols.length - 2)}px)`;
    setTimeout(() => strip.classList.remove('blur'), Math.max(0, duration - 300));
    return new Promise((resolve) => setTimeout(() => {
      this.reelState[i] = landing;
      this.renderStrip(strip, landing);
      strip.style.transition = 'none';
      strip.style.transform = `translateY(${this.stripOffset(reel, strip, 1)}px)`;
      reel.classList.remove('stop'); void reel.offsetWidth; reel.classList.add('stop');
      audio.reelStop(i);
      resolve();
    }, duration));
  }

  pullLever() {
    const lever = $('lever');
    lever.classList.remove('pulled'); void lever.offsetWidth; lever.classList.add('pulled');
    audio.lever();
  }

  async spin() {
    if (this.spinning || this.current !== 'slots') return;
    if (!this.profile || this.profile.coins < SPIN_COST) {
      this.slotMessage('Zu wenig Münzen – flieg eine Runde!');
      return;
    }
    audio.ensure();
    this.spinning = true;
    this.setSlotControls(false);
    $('slot-result').innerHTML = '';
    const machine = $('machine');
    const reelEls = [...document.querySelectorAll('.reel')];
    this.resetMachineEffects();
    this.pullLever();
    const startCoins = this.profile.coins;
    let res;
    try {
      res = await api.spin();
    } catch (e) {
      this.slotMessage(e.message);
      this.spinning = false;
      await this.refreshProfile();
      return;
    }
    this.game.applyProfile(res.profile);
    machine.classList.add('spinning');
    $('slot-coins').textContent = fmt(startCoins - SPIN_COST);
    const { reels } = res;
    const tense = reels[0] === reels[1];
    const durations = [0, 1, 2].map((i) => SPIN_MS.base + i * SPIN_MS.step + (i === 2 && tense ? SPIN_MS.tension : 0));
    const tease = tense && reels[2] !== reels[0] ? reels[0] : null;
    let ticker = setInterval(() => audio.tick(), 90);
    this.reelsMoving = true;
    const done = reelEls.map((el, i) => this.spinReel(el, i, reels[i], durations[i], i === 2 ? tease : null));
    if (tense) {
      done[1].then(() => {
        machine.classList.add('tense');
        reelEls[2].classList.add('tense');
        audio.tension((durations[2] - durations[1]) / 1000);
        clearInterval(ticker);
        ticker = setInterval(() => audio.heartbeat(), 300);
      });
    }
    await Promise.all(done);
    this.reelsMoving = false;
    clearInterval(ticker);
    if (this.current === 'slots') this.layoutReels();
    machine.classList.remove('spinning', 'tense');
    reelEls[2].classList.remove('tense');
    await this.showSlotResult(res, startCoins - SPIN_COST, reelEls);
    const signup = res.result.kind === 'item' && !res.result.duplicate && await this.game.slotNudge();
    this.spinning = false;
    this.setProfile(this.profile);
    if (signup) this.openAccount('signup');
  }

  flashBanner(text, cls = '', color = '') {
    const el = $('slot-flash');
    el.textContent = text;
    el.className = 'slot-flash ' + cls;
    el.style.setProperty('--rc', color);
    void el.offsetWidth;
    el.classList.add('show');
  }

  rain(count, color = null) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = $('coin-rain');
    for (let i = 0; i < count; i++) {
      const d = document.createElement('span');
      d.className = color ? 'drop confetti' : 'drop coin-icon';
      d.style.setProperty('--x', `${rand(0, 100)}%`);
      d.style.setProperty('--dx', `${rand(-80, 80)}px`);
      d.style.setProperty('--r', `${rand(-900, 900)}deg`);
      d.style.setProperty('--d', `${rand(1.3, 2.3)}s`);
      d.style.setProperty('--delay', `${rand(0, 0.6)}s`);
      if (color) d.style.setProperty('--c', Math.random() < 0.6 ? color : '#ffe27a');
      d.addEventListener('animationend', () => d.remove());
      box.append(d);
    }
  }

  countCoins(from, to, ms = 800) {
    const el = $('slot-coins');
    if (from === to) {
      el.textContent = fmt(to);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const t0 = performance.now();
      let last = -1;
      const step = (now) => {
        const k = Math.min(1, (now - t0) / ms);
        el.textContent = fmt(Math.round(from + (to - from) * (1 - (1 - k) ** 3)));
        const bucket = Math.floor(k * 14);
        if (bucket !== last && to > from) { last = bucket; audio.countTick(); }
        if (k < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  async showSlotResult(res, fromCoins, reelEls) {
    const r = res.result;
    const box = $('slot-result');
    const machine = $('machine');
    const { reels } = res;
    if (r.kind === 'nothing') {
      machine.classList.add('lose');
      this.slotMessage(LOSE_LINES[Math.floor(Math.random() * LOSE_LINES.length)]);
      box.firstElementChild.classList.add('prize-lose');
      audio.lose();
    } else if (r.kind === 'coins') {
      const jackpot = r.combo === 'jackpot';
      reelEls.forEach((el, i) => {
        if (jackpot || reels.filter((s) => s === reels[i]).length > 1) el.classList.add('hit');
      });
      machine.classList.add(jackpot ? 'jackpot' : 'win');
      this.flashBanner(jackpot ? 'JACKPOT!' : 'PAAR!', jackpot ? 'gold' : '');
      box.innerHTML = `<div class="prize prize-coins${jackpot ? ' prize-jackpot' : ''}"><span class="coin-icon"></span>+${fmt(r.amount)} Münzen</div>` +
        (r.nearMiss ? '<div class="near">So knapp am Hauptgewinn! 😬</div>' : '');
      this.rain(jackpot ? 50 : 12);
      if (jackpot) audio.jackpot();
      else audio.win('coins');
    } else {
      const it = r.item, rar = RARITIES[it.rarity];
      reelEls.forEach((el) => el.classList.add('hit'));
      box.innerHTML = `
        <div class="prize prize-item" style="--rc:${rar.color}">
          ${swatch(it, true)}
          <div class="prize-text">
            <small style="color:${rar.color}">${rar.label} · ${CATEGORIES[it.category]}</small>
            <b>${it.name}</b>
            <span class="muted">${r.duplicate ? `Doppelt → +${r.refund} Münzen` : 'NEU in deiner Garage!'}</span>
          </div>
          ${r.duplicate ? '' : '<button class="btn btn-small" id="btn-equip-new">Anziehen</button>'}
        </div>`;
      if (!r.duplicate) {
        $('btn-equip-new').onclick = async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          if (await this.equip(it.id)) btn.textContent = 'Aktiv ✓';
          else btn.disabled = false;
        };
      }
      const big = it.rarity === 'epic' || it.rarity === 'legendary';
      machine.classList.add(big ? 'jackpot' : 'win');
      this.flashBanner(`${rar.label.toUpperCase()}!`, 'rare', rar.color);
      this.rain(CONFETTI[it.rarity], rar.color);
      if (it.rarity === 'legendary') this.rain(30);
      audio.win(it.rarity);
    }
    await this.countCoins(fromCoins, res.profile.coins);
  }

  openGarage() {
    this.showScreen('garage');
    this.renderGarage();
  }

  async refreshProfile() {
    try {
      this.game.applyProfile(await api.getMe());
    } catch (e) {
      this.setProfile(this.profile);
    }
  }

  async equip(id) {
    try {
      const res = await api.equip(id);
      this.game.applyProfile(res.profile);
      return true;
    } catch (e) {
      await this.refreshProfile();
      return false;
    } finally {
      if (this.current === 'garage') this.renderGarage();
    }
  }

  renderGarage() {
    const p = this.profile;
    const inv = new Set(p.inventory);
    const eq = p.equipped[this.garageCat];
    const items = itemsByCategory(this.garageCat)
      .sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity));
    const owned = items.filter((i) => inv.has(i.id)).length;
    $('garage-progress').textContent = `${owned} / ${items.length} gesammelt`;
    $('garage-progress-fill').style.transform = `scaleX(${owned / items.length})`;
    const grid = $('garage-grid');
    grid.innerHTML = items.map((it) => {
      const has = inv.has(it.id), rar = RARITIES[it.rarity];
      return `<button class="item ${has ? '' : 'locked'} ${eq === it.id ? 'equipped' : ''}" data-id="${it.id}" style="--rc:${rar.color}" ${has ? '' : 'disabled'}>
        ${has ? swatch(it) : '<span class="swatch locked-swatch">?</span>'}
        <b>${has ? it.name : '???'}</b>
        <small>${rar.label}</small>
        ${eq === it.id ? '<span class="tag">Aktiv</span>' : ''}
      </button>`;
    }).join('');
    grid.querySelectorAll('.item:not(.locked)').forEach((b) => { b.onclick = () => this.equip(b.dataset.id); });
  }

  openAccount(mode) {
    if (mode) this.accountMode = mode;
    this.showScreen('account');
    this.renderAccount();
  }

  hasGuestProgress() {
    const p = this.profile;
    if (!p || p.username) return false;
    return p.totalRuns > 0 || p.coins !== START_COINS || p.inventory.length > DEFAULT_ITEM_COUNT;
  }

  renderAccount() {
    const name = this.profile?.username;
    $('account-guest').classList.toggle('hidden', !!name);
    $('account-user').classList.toggle('hidden', !name);
    $('account-name').textContent = name || '';
    this.renderConsentState();
    this.closeDelete();
    this.setAccountMode(this.accountMode);
  }

  renderConsentState() {
    const c = this.profile?.consent;
    const onOff = (v) => (v ? 'an' : 'aus');
    $('account-consent-state').textContent = c?.decided
      ? `Statistik: ${onOff(c.stats)} · Personalisierte Angebote: ${onOff(c.personal)}`
      : 'Noch keine Auswahl getroffen.';
  }

  openDelete() {
    const registered = !!this.profile?.username;
    $('delete-text').textContent = registered
      ? 'Dein Konto, dein Spielstand, deine Münzen und Items werden endgültig gelöscht. Gib zur Bestätigung dein Passwort ein.'
      : 'Dein Gast-Spielstand mit Münzen und Items wird endgültig gelöscht. Danach startest du neu.';
    $('delete-password-label').classList.toggle('hidden', !registered);
    $('delete-password').value = '';
    $('delete-error').textContent = '';
    $('btn-delete-open').classList.add('hidden');
    $('delete-form').classList.remove('hidden');
    (registered ? $('delete-password') : $('btn-delete-cancel')).focus({ preventScroll: true });
  }

  closeDelete() {
    $('delete-form').classList.add('hidden');
    $('btn-delete-open').classList.remove('hidden');
    $('delete-password').value = '';
    $('delete-error').textContent = '';
  }

  async deleteAccount() {
    if (this.deleteBusy) return;
    const registered = !!this.profile?.username;
    const password = $('delete-password').value;
    if (registered && !password) {
      $('delete-error').textContent = 'Passwort falsch';
      return;
    }
    this.deleteBusy = true;
    $('btn-delete-confirm').disabled = true;
    try {
      const res = await api.deleteAccount(registered ? password : undefined);
      this.game.applyProfile(res.profile);
      $('account-username').value = '';
      this.accountMode = 'signup';
      this.renderAccount();
      this.showNotice('Dein Konto und deine Daten wurden gelöscht. Du spielst jetzt mit einem neuen Gast-Spielstand.');
      this.game.ensureConsent();
    } catch (e) {
      if (e.status === 401) await this.sessionLost(e.message);
      else $('delete-error').textContent = e.message;
    } finally {
      this.deleteBusy = false;
      $('btn-delete-confirm').disabled = false;
    }
  }

  async sessionLost(message) {
    const name = this.profile?.username || '';
    try {
      this.game.applyProfile(await api.getMe());
    } catch (e) {
      $('delete-error').textContent = e.message;
      return;
    }
    $('account-username').value = name;
    $('account-password').value = '';
    this.accountMode = 'login';
    this.renderAccount();
    $('account-error').textContent = message;
    this.game.ensureConsent();
  }

  setAccountMode(mode) {
    this.accountMode = mode;
    const login = mode === 'login';
    document.querySelectorAll('#account .tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
    $('account-password').setAttribute('autocomplete', login ? 'current-password' : 'new-password');
    $('account-submit').textContent = login ? 'Anmelden' : 'Registrieren';
    $('account-warning').classList.toggle('hidden', !login || !this.hasGuestProgress());
    $('account-error').textContent = '';
  }

  async submitAccount() {
    if (this.accountBusy) return;
    const username = $('account-username').value.trim();
    const password = $('account-password').value;
    const login = this.accountMode === 'login';
    const error = $('account-error');
    if (!login && !ACCOUNT.usernamePattern.test(username)) {
      error.textContent = 'Benutzername: 3–20 Zeichen (A–Z, 0–9, _ . -)';
      return;
    }
    if (!login && (password.length < ACCOUNT.passwordMin || password.length > ACCOUNT.passwordMax)) {
      error.textContent = 'Passwort: 8–128 Zeichen';
      return;
    }
    this.accountBusy = true;
    $('account-submit').disabled = true;
    error.textContent = '';
    try {
      const res = login ? await api.login(username, password) : await api.signup(username, password);
      $('account-password').value = '';
      this.game.applyProfile(res.profile);
      this.renderAccount();
      if (login) this.game.ensureConsent();
    } catch (e) {
      error.textContent = e.message;
    } finally {
      this.accountBusy = false;
      $('account-submit').disabled = false;
    }
  }

  async logout() {
    const btn = $('btn-logout');
    btn.disabled = true;
    try {
      const res = await api.logout();
      this.game.applyProfile(res.profile);
      $('account-username').value = '';
      this.accountMode = 'login';
      this.renderAccount();
      this.game.ensureConsent();
    } catch (e) {
      this.setConnection('error', e.message);
      this.showScreen('menu');
    } finally {
      btn.disabled = false;
    }
  }
}

export { getItem };
