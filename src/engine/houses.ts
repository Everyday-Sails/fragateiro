// Houses near the camera, where the land cover (ESA WorldCover, see scripts/fetch-landcover.mjs)
// says the land is built up: a schematic town, not the real buildings. Houses stand in rows
// along streets; each neighbourhood (about 160 m) has its own street direction. Where the town
// is dense there are taller blocks of flats among the houses. Two shapes, as thin instances:
// a house with a terracotta roof and a flat-roofed block.
//
// The heights are a surface model, already lifted by the buildings, so each one is sunk a
// little into it.

import { Color3, MeshBuilder, VertexData, Mesh, type Scene } from '@babylonjs/core';
import type { LandMask } from '../world/landMask';
import type { Terrain } from '../world/terrain';
import { Scatter, TILE, pushInstance, type CoverGrid } from './scatter';
import { finish, paint } from './trees';

/** Spacing of the plots along a street, m. */
const PLOT = 13;
/** Size of a neighbourhood with one street direction, m. */
const QUARTER = 160;
/** Every STREET-th row of plots is a street. */
const STREET = 4;
/** Steeper than this (rise over run): no houses. */
const MAX_SLOPE = 0.6;

export class Houses extends Scatter {
  constructor(
    scene: Scene,
    cover: CoverGrid,
    mask: LandMask,
    terrain: Terrain | undefined,
    range: number,
    /** Places kept clear (landmarks), world x, y and radius. */
    private readonly clear: { x: number; y: number; r: number }[] = [],
  ) {
    super([houseMesh(scene), blockMesh(scene)], cover, mask, terrain, range);
  }

  protected build(ti: number, tj: number, rand: () => number): number[][] {
    const houses: number[] = [];
    const blocks: number[] = [];
    const x0 = ti * TILE;
    const y0 = tj * TILE;
    // The neighbourhoods in this square.
    for (let qy = y0; qy < y0 + TILE; qy += QUARTER)
      for (let qx = x0; qx < x0 + TILE; qx += QUARTER) {
        const w = Math.min(QUARTER, x0 + TILE - qx);
        const hgt = Math.min(QUARTER, y0 + TILE - qy);
        const cx = qx + w / 2;
        const cy = qy + hgt / 2;
        if (this.share(this.cover.built, cx, cy) < 0.05 && rand() < 0.9) continue; // nothing built near
        const angle = rand() * Math.PI;
        const ca = Math.cos(angle);
        const sa = Math.sin(angle);
        const n = Math.ceil((QUARTER * 0.75) / PLOT);
        for (let v = -n; v <= n; v++) {
          if (((v % STREET) + STREET) % STREET === 0) continue; // a street
          for (let u = -n; u <= n; u++) {
            if (((u % (STREET * 2)) + STREET * 2) % (STREET * 2) === 0) continue; // a cross street
            const lx = (u + (rand() - 0.5) * 0.15) * PLOT;
            const ly = (v + (rand() - 0.5) * 0.15) * PLOT;
            const x = cx + lx * ca - ly * sa;
            const y = cy + lx * sa + ly * ca;
            // Only the plots inside this neighbourhood's own square.
            if (x < qx || x >= qx + w || y < qy || y >= qy + hgt) continue;
            const built = this.share(this.cover.built, x, y);
            if (rand() >= Math.pow(built, 0.8) * 0.9) continue;
            if (this.mask.wetness(x, y) > 0.1) continue;
            if (this.clear.some((c) => Math.hypot(c.x - x, c.y - y) < c.r)) continue;
            const { h, slope } = this.ground(x, y);
            if (slope > MAX_SLOPE) continue;
            // Faces the street: its long side along u.
            const yaw = -angle + Math.PI / 2;
            if (built > 0.7 && rand() < 0.35) {
              // A block of flats: 4 to 8 floors.
              const floors = 4 + Math.floor(rand() * 5);
              const tall = floors * 3;
              const base = this.terrain ? Math.max(0, h - tall * 0.5) : 0;
              pushInstance(blocks, x, base, y, PLOT * (0.85 + rand() * 0.15), tall, PLOT * (0.7 + rand() * 0.2), yaw);
            } else {
              // A house of one or two floors.
              const tall = rand() < 0.6 ? 3.2 : 6.2;
              const base = this.terrain ? Math.max(0, h - tall * 0.5) : 0;
              pushInstance(houses, x, base, y, PLOT * (0.6 + rand() * 0.25), tall, PLOT * (0.5 + rand() * 0.2), yaw);
            }
          }
        }
      }
    return [houses, blocks];
  }
}

/** A house 1 m wide, 1 m deep and 1 m to the eaves, with a hipped terracotta roof on top. */
function houseMesh(scene: Scene): Mesh {
  const walls = MeshBuilder.CreateBox('house-walls', { width: 1, depth: 1, height: 1 }, scene);
  walls.position.y = 0.5;
  paint(walls, new Color3(0.9, 0.87, 0.8));
  // The roof: a low pyramid, its slope kept fixed by scaling with the house's height (0.12
  // of a 3 m house: 1.2 m, a little steeper on a taller one, which reads well from afar).
  const roof = new Mesh('house-roof', scene);
  const p = [-0.55, 1, -0.55, 0.55, 1, -0.55, 0.55, 1, 0.55, -0.55, 1, 0.55, 0, 1.12, 0];
  const vd = new VertexData();
  vd.positions = p;
  vd.indices = [0, 4, 1, 1, 4, 2, 2, 4, 3, 3, 4, 0];
  const normals: number[] = [];
  VertexData.ComputeNormals(p, vd.indices, normals);
  vd.normals = normals;
  vd.applyToMesh(roof);
  paint(roof, new Color3(0.66, 0.34, 0.24));
  // Flat-shaded: split the vertices so each face has its own normal.
  roof.convertToFlatShadedMesh();
  return finish(scene, 'houses', [walls, roof]);
}

/** A block of flats: a pale box 1 m each way, with a darker flat roof. */
function blockMesh(scene: Scene): Mesh {
  const box = MeshBuilder.CreateBox('block', { width: 1, depth: 1, height: 1 }, scene);
  box.position.y = 0.5;
  paint(box, new Color3(0.86, 0.85, 0.82));
  const top = MeshBuilder.CreateBox('block-top', { width: 1.02, depth: 1.02, height: 0.02 }, scene);
  top.position.y = 1;
  paint(top, new Color3(0.55, 0.53, 0.5));
  return finish(scene, 'blocks', [box, top]);
}
