// Trees on the land near the camera, where the land cover (ESA WorldCover, see
// scripts/fetch-landcover.mjs) says there are woods. Two simple shapes, drawn as thin
// instances (one draw call each): umbrella pines and rounder broadleaf trees (eucalyptus,
// cork oaks). Beyond DRAW_RADIUS the woods are only the ground's colour.
//
// The heights are a surface model: over a wood the "ground" is already the top of the
// canopy, so each tree is sunk until its crown just shows above that surface.

import { Color3, Matrix, Mesh, MeshBuilder, Quaternion, StandardMaterial, Vector3, type Camera, type Scene } from '@babylonjs/core';
import type { LandMask } from '../world/landMask';
import type { Terrain } from '../world/terrain';

export interface CoverGrid {
  cellSize: number;
  width: number;
  height: number;
  northWest: { x: number; y: number };
  /** Share of trees in each cell, 0..255 (row 0 = north edge). */
  trees: Uint8Array;
}

/** Trees are drawn within this distance of the camera, m. */
const DRAW_RADIUS = 2200;
/** Side of the squares the trees are made in, m (rebuilt as the camera moves). */
const TILE = 500;
/** Spacing of the candidate spots in a full wood, m. */
const SPACING = 16;
/** Steeper than this (rise over run) is a cliff: no trees. */
const MAX_SLOPE = 0.9;

export class Trees {
  private readonly pine: Mesh;
  private readonly broad: Mesh;
  private readonly tiles = new Map<string, { pine: Float32Array; broad: Float32Array }>();
  private lastKey = '';

  constructor(
    scene: Scene,
    private readonly cover: CoverGrid,
    private readonly mask: LandMask,
    private readonly terrain: Terrain | undefined,
  ) {
    this.pine = treeMesh(scene, 'tree-pine', true);
    this.broad = treeMesh(scene, 'tree-broad', false);
  }

  /** Share of trees at a world point, 0..1 (nearest cell). */
  private share(x: number, y: number): number {
    const c = this.cover;
    const i = Math.floor((x - c.northWest.x) / c.cellSize);
    const j = Math.floor((c.northWest.y - y) / c.cellSize);
    if (i < 0 || j < 0 || i >= c.width || j >= c.height) return 0;
    return c.trees[j * c.width + i] / 255;
  }

  /** The trees of one square, as instance matrices (always the same for the same square). */
  private build(ti: number, tj: number): { pine: Float32Array; broad: Float32Array } {
    const pine: number[] = [];
    const broad: number[] = [];
    const rand = seeded(ti * 73856093 ^ tj * 19349663);
    const m = new Matrix();
    const q = new Quaternion();
    const s = new Vector3();
    const t = new Vector3();
    const x0 = ti * TILE;
    const y0 = tj * TILE;
    for (let b = 0; b < TILE / SPACING; b++)
      for (let a = 0; a < TILE / SPACING; a++) {
        const x = x0 + (a + rand()) * SPACING;
        const y = y0 + (b + rand()) * SPACING;
        const r = rand();
        if (r >= this.share(x, y)) continue;
        // On dry land, a little back from the shore.
        if (this.mask.wetness(x, y) > 0.1) continue;
        const h = this.terrain ? this.terrain.heightAt(x, y) : 0;
        if (this.terrain) {
          const dx = this.terrain.heightAt(x + 10, y) - h;
          const dy = this.terrain.heightAt(x, y + 10) - h;
          if (Math.hypot(dx, dy) / 10 > MAX_SLOPE) continue;
        }
        const isPine = rand() < 0.55;
        const size = 0.75 + rand() * 0.6;
        const tall = (isPine ? 11 : 13) * size;
        // Sink the tree into the canopy surface, leaving its crown showing.
        const base = this.terrain ? Math.max(0, h - tall * 0.55) : 0;
        s.set(size * (0.9 + rand() * 0.2), size, size * (0.9 + rand() * 0.2));
        Quaternion.RotationYawPitchRollToRef(rand() * Math.PI * 2, (rand() - 0.5) * 0.08, (rand() - 0.5) * 0.08, q);
        t.set(x, base, y);
        Matrix.ComposeToRef(s, q, t, m);
        const out = isPine ? pine : broad;
        for (let k = 0; k < 16; k++) out.push(m.m[k]);
      }
    return { pine: Float32Array.from(pine), broad: Float32Array.from(broad) };
  }

  /** Call every frame: rebuilds the trees when the camera moves to another square. */
  update(camera: Camera): void {
    const p = camera.globalPosition;
    const ci = Math.floor(p.x / TILE);
    const cj = Math.floor(p.z / TILE);
    const key = `${ci},${cj}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const n = Math.ceil(DRAW_RADIUS / TILE);
    const wanted = new Set<string>();
    for (let dj = -n; dj <= n; dj++)
      for (let di = -n; di <= n; di++) {
        const i = ci + di;
        const j = cj + dj;
        // Squares whose nearest point is within the radius.
        const nx = Math.max(i * TILE, Math.min(p.x, (i + 1) * TILE));
        const nz = Math.max(j * TILE, Math.min(p.z, (j + 1) * TILE));
        if (Math.hypot(nx - p.x, nz - p.z) > DRAW_RADIUS) continue;
        const k = `${i},${j}`;
        wanted.add(k);
        if (!this.tiles.has(k)) this.tiles.set(k, this.build(i, j));
      }
    for (const k of this.tiles.keys()) if (!wanted.has(k)) this.tiles.delete(k);
    const join = (part: 'pine' | 'broad') => {
      const list = [...this.tiles.values()].map((t) => t[part]);
      const all = new Float32Array(list.reduce((sum, a) => sum + a.length, 0));
      let o = 0;
      for (const a of list) {
        all.set(a, o);
        o += a.length;
      }
      return all;
    };
    for (const [mesh, part] of [
      [this.pine, 'pine'],
      [this.broad, 'broad'],
    ] as const) {
      const buf = join(part);
      mesh.thinInstanceSetBuffer('matrix', buf, 16, false);
      mesh.setEnabled(buf.length > 0);
    }
  }

  setVisible(visible: boolean): void {
    this.pine.setEnabled(visible);
    this.broad.setEnabled(visible);
  }

  /** How many trees are drawn now. */
  get count(): number {
    return this.pine.thinInstanceCount + this.broad.thinInstanceCount;
  }
}

/** A low tree: a trunk and a crown (a flat umbrella for a pine, a round head otherwise). */
function treeMesh(scene: Scene, name: string, pine: boolean): Mesh {
  const trunk = MeshBuilder.CreateCylinder(`${name}-trunk`, { height: pine ? 8 : 7, diameterTop: 0.35, diameterBottom: 0.6, tessellation: 5 }, scene);
  trunk.position.y = pine ? 4 : 3.5;
  const crown = pine
    ? MeshBuilder.CreateSphere(`${name}-crown`, { diameterX: 9, diameterY: 3.6, diameterZ: 9, segments: 3 }, scene)
    : MeshBuilder.CreateSphere(`${name}-crown`, { diameterX: 7, diameterY: 7.5, diameterZ: 7, segments: 3 }, scene);
  crown.position.y = pine ? 9.5 : 9;
  const paint = (m: Mesh, c: Color3) => {
    const n = m.getTotalVertices();
    const colors = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b, 1], i * 4);
    m.setVerticesData('color', colors);
  };
  paint(trunk, new Color3(0.33, 0.25, 0.18));
  paint(crown, pine ? new Color3(0.2, 0.3, 0.17) : new Color3(0.3, 0.38, 0.22));
  const tree = Mesh.MergeMeshes([trunk, crown], true, true)!;
  tree.name = name;
  const mat = new StandardMaterial(`${name}-mat`, scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor = Color3.Black();
  tree.material = mat;
  tree.useVertexColors = true;
  tree.isPickable = false;
  tree.alwaysSelectAsActiveMesh = true;
  tree.thinInstanceSetBuffer('matrix', new Float32Array(16), 16, false);
  tree.setEnabled(false);
  return tree;
}

/** A small repeatable random generator (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
