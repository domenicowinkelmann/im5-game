const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isTyping = (el) => el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
const KEYS = {
  left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'],
};

export class Input {
  constructor(el) {
    this.keys = new Set();
    this.turn = 0; this.pitch = 0;
    this.drag = null;
    window.addEventListener('keydown', (e) => {
      if (isTyping(e.target)) return;
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    el.addEventListener('pointerdown', (e) => {
      this.drag = { x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 };
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      this.drag.dx = e.clientX - this.drag.x0;
      this.drag.dy = e.clientY - this.drag.y0;
    });
    const end = () => { this.drag = null; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  has(list) { return list.some((k) => this.keys.has(k)); }

  update(dt) {
    let t = (this.has(KEYS.right) ? 1 : 0) - (this.has(KEYS.left) ? 1 : 0);
    let p = (this.has(KEYS.up) ? 1 : 0) - (this.has(KEYS.down) ? 1 : 0);
    if (this.drag) {
      t = clamp(this.drag.dx / 90, -1, 1);
      p = clamp(-this.drag.dy / 90, -1, 1);
    }
    const k = Math.min(1, dt * 8);
    this.turn += (t - this.turn) * k;
    this.pitch += (p - this.pitch) * k;
    return this;
  }
}
