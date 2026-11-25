// Things scattered on the land near the camera (trees, houses), drawn as thin instances in
// squares of TILE metres that are made when the camera comes near and dropped when it leaves.
// Each square is always made the same way (seeded by its position).

import { Matrix, Quaternion, Vector3, type Camera, type Mesh } from '@babylonjs/core';
import type { LandMask } from '../world/landMask';
import type { Terrain } from '../world/terrain';

export interface CoverGrid {
  cellSize: number;
  width: number;
  height: number;
  northWest: { x: number; y: number };
  /** Share of built-up land and of trees in each cell, 0..255 (row 0 = north edge). */
  built: Uint8Array;
  trees: Uint8Array;
}

/** Side of the squares, m. */
export const TILE = 500;

export abstract class Scatter {
  private readonly tiles = new Map<string, Float32Array[]>();
  private lastKey = '';
  /** Drawn within this distance of the camera, m (0: not at all). */
  private range: number;

  constructor(
    protected readonly meshes: Mesh[],
    protected readonly cover: CoverGrid,
    protected readonly mask: LandMask,
    protected readonly terrain: Terrain | undefined,
    range: number,
  ) {
    this.range = range;
  }

  /** The instance matrices of one square, one list per mesh. */
  protected abstract build(ti: number, tj: number, rand: () => number): number[][];

  /** Share (0..1) of a cover layer at a world point (nearest cell). */
  protected share(layer: Uint8Array, x: number, y: number): number {
    const c = this.cover;
    const i = Math.floor((x - c.northWest.x) / c.cellSize);
    const j = Math.floor((c.northWest.y - y) / c.cellSize);
    if (i < 0 || j < 0 || i >= c.width || j >= c.height) return 0;
    return layer[j * c.width + i] / 255;
  }

  /** Ground height and slope (rise over run) at a point. */
  protected ground(x: number, y: number): { h: number; slope: number } {
    if (!this.terrain) return { h: 0, slope: 0 };
    const h = this.terrain.heightAt(x, y);
    const dx = this.terrain.heightAt(x + 10, y) - h;
    const dy = this.terrain.heightAt(x, y + 10) - h;
    return { h, slope: Math.hypot(dx, dy) / 10 };
  }

  /** Change how far out things are drawn (the graphics setting); 0 hides them. */
  setRange(range: number): void {
    if (range === this.range) return;
    this.range = range;
    this.lastKey = '';
    if (!range) {
      this.tiles.clear();
      for (const m of this.meshes) m.setEnabled(false);
    }
  }

  /** Call every frame: rebuilds when the camera moves to another square. */
  update(camera: Camera): void {
    if (!this.range) return;
    const p = camera.globalPosition;
    const ci = Math.floor(p.x / TILE);
    const cj = Math.floor(p.z / TILE);
    const key = `${ci},${cj}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const n = Math.ceil(this.range / TILE);
    const wanted = new Set<string>();
    for (let dj = -n; dj <= n; dj++)
      for (let di = -n; di <= n; di++) {
        const i = ci + di;
        const j = cj + dj;
        const nx = Math.max(i * TILE, Math.min(p.x, (i + 1) * TILE));
        const nz = Math.max(j * TILE, Math.min(p.z, (j + 1) * TILE));
        if (Math.hypot(nx - p.x, nz - p.z) > this.range) continue;
        const k = `${i},${j}`;
        wanted.add(k);
        if (!this.tiles.has(k)) this.tiles.set(k, this.build(i, j, seeded(i * 73856093 ^ j * 19349663)).map((l) => Float32Array.from(l)));
      }
    for (const k of this.tiles.keys()) if (!wanted.has(k)) this.tiles.delete(k);
    this.meshes.forEach((mesh, part) => {
      const list = [...this.tiles.values()].map((t) => t[part]);
      const all = new Float32Array(list.reduce((sum, a) => sum + a.length, 0));
      let o = 0;
      for (const a of list) {
        all.set(a, o);
        o += a.length;
      }
      mesh.thinInstanceSetBuffer('matrix', all, 16, false);
      mesh.setEnabled(all.length > 0);
    });
  }

  /** How many things are drawn now. */
  get count(): number {
    return this.meshes.reduce((s, m) => s + (m.isEnabled() ? m.thinInstanceCount : 0), 0);
  }
}

const m = new Matrix();
const q = new Quaternion();
const sv = new Vector3();
const tv = new Vector3();
/** Push the matrix of an instance (scale, turn about the vertical, position) onto a list. */
export function pushInstance(out: number[], x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, tilt = 0, tilt2 = 0): void {
  sv.set(sx, sy, sz);
  Quaternion.RotationYawPitchRollToRef(yaw, tilt, tilt2, q);
  tv.set(x, y, z);
  Matrix.ComposeToRef(sv, q, tv, m);
  for (let k = 0; k < 16; k++) out.push(m.m[k]);
}

/** A small repeatable random generator (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
