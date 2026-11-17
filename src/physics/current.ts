// Water currents (tidal streams). The boat moves through the water; the water itself moves
// over the ground with the current, which carries the boat with it. Its sails feel the wind
// over the water, not over the ground.

export interface CurrentField {
  /** Water velocity over the ground at (x east, y north), m/s. */
  at(x: number, y: number): { east: number; north: number };
}

/** Still water. */
export const NO_CURRENT: CurrentField = { at: () => ({ east: 0, north: 0 }) };

/** A steady, even stream (tests and simple cases). */
export class SteadyCurrent implements CurrentField {
  constructor(
    public east = 0,
    public north = 0,
  ) {}
  at(): { east: number; north: number } {
    return { east: this.east, north: this.north };
  }
}

export interface CurrentGridMeta {
  /** Size of a grid cell, m. */
  cellSize: number;
  width: number;
  height: number;
  /** World position (m east, north) of the grid's north-west corner. */
  northWest: { x: number; y: number };
}

/**
 * A stream given on a grid (row 0 = north edge), interpolated between cell centres and
 * multiplied by `factor`: 1 at the height of the ebb, -1 at the height of the flood (the same
 * stream reversed), 0 at slack water.
 */
export class GridCurrent implements CurrentField {
  factor = 1;
  constructor(
    readonly meta: CurrentGridMeta,
    /** East and north speed per cell at factor 1, m/s. */
    readonly east: Float32Array,
    readonly north: Float32Array,
  ) {
    if (east.length !== meta.width * meta.height || north.length !== east.length) throw new Error('current grid size does not match its metadata');
  }

  at(x: number, y: number): { east: number; north: number } {
    if (!this.factor) return { east: 0, north: 0 };
    const m = this.meta;
    const fx = (x - m.northWest.x) / m.cellSize - 0.5;
    const fy = (m.northWest.y - y) / m.cellSize - 0.5;
    if (fx < 0 || fy < 0 || fx >= m.width - 1 || fy >= m.height - 1) return { east: 0, north: 0 };
    const c = Math.floor(fx);
    const r = Math.floor(fy);
    const tx = fx - c;
    const ty = fy - r;
    const i = r * m.width + c;
    const lerp = (g: Float32Array) => {
      const top = g[i] + (g[i + 1] - g[i]) * tx;
      const bottom = g[i + m.width] + (g[i + m.width + 1] - g[i + m.width]) * tx;
      return top + (bottom - top) * ty;
    };
    return { east: lerp(this.east) * this.factor, north: lerp(this.north) * this.factor };
  }
}
