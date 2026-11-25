// The graphics setting (low, medium, high): how much is drawn and at what resolution.
// Remembered in the browser; phones start on low, computers on high.

export type GraphicsLevel = 'low' | 'medium' | 'high';

export interface GraphicsSettings {
  /** Trees and houses are drawn within these distances of the camera, m (0: none). */
  treeRange: number;
  houseRange: number;
  /** Screen pixels per rendered pixel: above 1 renders at a lower resolution. */
  pixelScale: number;
}

const KEY = 'fragateiro.graphics';

export function graphicsSettings(level: GraphicsLevel, devicePixelRatio = 1): GraphicsSettings {
  const dpr = Math.max(1, devicePixelRatio);
  switch (level) {
    case 'low':
      return { treeRange: 0, houseRange: 0, pixelScale: 1.25 };
    case 'medium':
      return { treeRange: 1200, houseRange: 1100, pixelScale: 1 / Math.min(dpr, 1.5) };
    default:
      return { treeRange: 2200, houseRange: 2000, pixelScale: 1 / Math.min(dpr, 2) };
  }
}

export function loadGraphicsLevel(): GraphicsLevel {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'low' || v === 'medium' || v === 'high') return v;
  } catch {
    // storage blocked
  }
  const phone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return phone ? 'low' : 'high';
}

export function saveGraphicsLevel(level: GraphicsLevel): void {
  try {
    localStorage.setItem(KEY, level);
  } catch {
    // storage blocked: only this visit
  }
}
