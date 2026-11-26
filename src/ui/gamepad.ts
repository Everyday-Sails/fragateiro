// Game controllers (an Xbox controller, or any the browser reads with the "standard" layout),
// through the Gamepad API: read once a frame. Sticks have a dead zone; buttons report when
// they are first pressed. Menus are worked with the D-pad (or the left stick): the nearest
// button in that direction gets the focus, A presses it, B goes back.

/** Standard layout: buttons. */
export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  View: 8,
  Menu: 9,
  LS: 10,
  RS: 11,
  Up: 12,
  Down: 13,
  Left: 14,
  Right: 15,
} as const;

const DEAD_ZONE = 0.2;

export interface PadState {
  /** Sticks, -1..1 (y down positive), dead zone removed. */
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  held(button: number): boolean;
  /** Pressed since the last frame. */
  pressed(button: number): boolean;
  /** A stick pushed past half-way this frame: -1, 0 or 1 on each axis (for menus and views). */
  flickX: number;
  flickY: number;
}

export class GamepadInput {
  private last = new Set<number>();
  private lastFlick = { x: 0, y: 0 };
  private pad: Gamepad | null = null;

  /** Is a controller connected (and has a button been pressed, as browsers require)? */
  get connected(): boolean {
    return !!this.pad;
  }

  poll(): PadState | null {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find((p) => p && p.connected && p.mapping === 'standard') ?? [...pads].find((p) => p && p.connected) ?? null;
    this.pad = pad;
    if (!pad) return null;
    const dz = (v = 0) => (Math.abs(v) < DEAD_ZONE ? 0 : (v - Math.sign(v) * DEAD_ZONE) / (1 - DEAD_ZONE));
    const now = new Set<number>();
    pad.buttons.forEach((b, i) => {
      if (b.pressed || b.value > 0.5) now.add(i);
    });
    const before = this.last;
    this.last = now;
    const lx = dz(pad.axes[0]);
    const ly = dz(pad.axes[1]);
    const flick = (v: number, prev: number) => (Math.abs(v) > 0.6 ? (Math.sign(v) !== prev ? Math.sign(v) : 0) : 0);
    const fx = flick(lx, this.lastFlick.x);
    const fy = flick(ly, this.lastFlick.y);
    this.lastFlick = { x: Math.abs(lx) > 0.6 ? Math.sign(lx) : Math.abs(lx) < 0.3 ? 0 : this.lastFlick.x, y: Math.abs(ly) > 0.6 ? Math.sign(ly) : Math.abs(ly) < 0.3 ? 0 : this.lastFlick.y };
    return {
      lx,
      ly,
      rx: dz(pad.axes[2]),
      ry: dz(pad.axes[3]),
      held: (b) => now.has(b),
      pressed: (b) => now.has(b) && !before.has(b),
      flickX: fx,
      flickY: fy,
    };
  }

  /** A short rumble, where the controller can (running aground). */
  rumble(strength = 0.6, ms = 250): void {
    const act = (this.pad as unknown as { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } })?.vibrationActuator;
    act?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 }).catch(() => {});
  }
}

const FOCUSABLE = 'button, select, input, a[href], [tabindex]:not([tabindex="-1"])';

/** Move the focus to the nearest visible control in a direction, inside `root`. */
export function moveFocus(root: HTMLElement, dx: number, dy: number): void {
  const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => {
    if ((e as HTMLButtonElement).disabled) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
  });
  if (!items.length) return;
  const current = document.activeElement as HTMLElement | null;
  if (!current || !items.includes(current)) {
    focus(items[0]);
    return;
  }
  const c = centre(current);
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const e of items) {
    if (e === current) continue;
    const p = centre(e);
    const ax = p.x - c.x;
    const ay = p.y - c.y;
    const along = ax * dx + ay * dy;
    if (along <= 2) continue; // not in that direction
    const across = Math.abs(ax * dy - ay * dx);
    const score = along + across * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  }
  if (best) focus(best);
}

/** Press the focused control (a select steps to its next option). */
export function activateFocus(root: HTMLElement): void {
  const e = document.activeElement as HTMLElement | null;
  if (!e || !root.contains(e)) {
    moveFocus(root, 0, 1);
    return;
  }
  if (e instanceof HTMLSelectElement) {
    e.selectedIndex = (e.selectedIndex + 1) % e.options.length;
    e.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  e.click();
}

function centre(e: HTMLElement): { x: number; y: number } {
  const r = e.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function focus(e: HTMLElement): void {
  e.focus({ preventScroll: false });
  e.scrollIntoView({ block: 'nearest' });
  document.body.classList.add('pad-focus');
}
