// Trees on the land near the camera, where the land cover (ESA WorldCover, see
// scripts/fetch-landcover.mjs) says there are woods: umbrella pines and rounder broadleaf
// trees (eucalyptus, cork oaks), as thin instances. Further out the woods are only the
// ground's colour.
//
// The heights are a surface model: over a wood the "ground" is already the top of the
// canopy, so each tree is sunk until its crown just shows above that surface.

import { Color3, Mesh, MeshBuilder, StandardMaterial, type Scene } from '@babylonjs/core';
import type { LandMask } from '../world/landMask';
import type { Terrain } from '../world/terrain';
import { Scatter, TILE, pushInstance, type CoverGrid } from './scatter';

/** Spacing of the candidate spots in a full wood, m. */
const SPACING = 16;
/** Steeper than this (rise over run) is a cliff: no trees. */
const MAX_SLOPE = 0.9;

export class Trees extends Scatter {
  constructor(scene: Scene, cover: CoverGrid, mask: LandMask, terrain: Terrain | undefined, range: number) {
    super([treeMesh(scene, 'tree-pine', true), treeMesh(scene, 'tree-broad', false)], cover, mask, terrain, range);
  }

  protected build(ti: number, tj: number, rand: () => number): number[][] {
    const pine: number[] = [];
    const broad: number[] = [];
    for (let b = 0; b < TILE / SPACING; b++)
      for (let a = 0; a < TILE / SPACING; a++) {
        const x = ti * TILE + (a + rand()) * SPACING;
        const y = tj * TILE + (b + rand()) * SPACING;
        if (rand() >= this.share(this.cover.trees, x, y)) continue;
        // On dry land, a little back from the shore.
        if (this.mask.wetness(x, y) > 0.1) continue;
        const { h, slope } = this.ground(x, y);
        if (slope > MAX_SLOPE) continue;
        const isPine = rand() < 0.55;
        const size = 0.75 + rand() * 0.6;
        const tall = (isPine ? 11 : 13) * size;
        // Sink the tree into the canopy surface, leaving its crown showing.
        const base = this.terrain ? Math.max(0, h - tall * 0.55) : 0;
        pushInstance(isPine ? pine : broad, x, base, y, size * (0.9 + rand() * 0.2), size, size * (0.9 + rand() * 0.2), rand() * Math.PI * 2, (rand() - 0.5) * 0.08, (rand() - 0.5) * 0.08);
      }
    return [pine, broad];
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
  paint(trunk, new Color3(0.33, 0.25, 0.18));
  paint(crown, pine ? new Color3(0.2, 0.3, 0.17) : new Color3(0.3, 0.38, 0.22));
  return finish(scene, name, [trunk, crown]);
}

/** Give every vertex of a mesh one colour. */
export function paint(m: Mesh, c: Color3): void {
  const n = m.getTotalVertices();
  const colors = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b, 1], i * 4);
  m.setVerticesData('color', colors);
}

/** Merge painted parts into one mesh ready for thin instances. */
export function finish(scene: Scene, name: string, parts: Mesh[]): Mesh {
  // No textures: drop the texture coordinates, so parts made by hand (without them) merge.
  for (const p of parts) p.removeVerticesData('uv');
  const mesh = Mesh.MergeMeshes(parts, true, true)!;
  mesh.name = name;
  const mat = new StandardMaterial(`${name}-mat`, scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor = Color3.Black();
  mesh.material = mat;
  mesh.useVertexColors = true;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.thinInstanceSetBuffer('matrix', new Float32Array(16), 16, false);
  mesh.setEnabled(false);
  return mesh;
}
