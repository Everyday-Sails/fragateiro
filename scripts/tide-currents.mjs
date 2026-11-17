#!/usr/bin/env node
// The tidal stream of the Tagus estuary, from the land/water map (no measured data needed).
//
//   node scripts/tide-currents.mjs
//
// While the tide falls, the whole estuary empties evenly: every square metre of water inside
// the bar loses the same height per second, and that water has to leave through the river
// mouth. The stream v = -grad(phi) carries h v through water of depth h, so phi solves
// div(h grad(phi)) = -1 in the estuary (0 outside it), with phi = 0 at the open sea (the
// map's edges) and no flow across the shore. The stream is fastest where much water has to
// pass through a narrow or shallow place. There are no depths on our map, so the depth is a
// guess: deeper away from the shore, up to 30 m in the deep channel from the bar to Barreiro
// and 5 m in the shallow inner bay (Mar da Palha, Montijo, Alcochete, Seixal). The stream is
// scaled so it runs at 3 knots under the Ponte 25 de Abril at the height of the ebb. The flood
// is the same stream reversed.
//
// Output: src/assets/map/tagus-current.png (R, G = east, north speed, 128 = still, 127 = the
// top speed in tagus-current.json; B = 255 in water) and tagus-current.json (grid and scale).

import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import sharp from 'sharp';

const MAP = new URL('../src/assets/map/', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('tagus.json', MAP)));
const KNOT = 1852 / 3600;
/** Peak ebb under the Ponte 25 de Abril, m/s. */
const BRIDGE_SPEED = 3 * KNOT;
/** Cells of the current grid, m (the mask's 20 m cells, 5 by 5). */
const STEP = 5;
const CELL = meta.cellSize * STEP;
/** The estuary, which fills and empties: inside the bar (east of Caxias and Trafaria), north of the Sado. */
const EAST_OF_LON = -9.27;
const NORTH_OF_LAT = 38.55;

const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON = 111320 * Math.cos((meta.origin.lat * Math.PI) / 180);
const xOfLon = (lon) => (lon - meta.origin.lon) * M_PER_DEG_LON;
const yOfLat = (lat) => (lat - meta.origin.lat) * M_PER_DEG_LAT;

// --- The water at 100 m --------------------------------------------------------------------
const { data, info } = await sharp(new URL('tagus-mask.png', MAP).pathname).raw().toBuffer({ resolveWithObject: true });
const W = Math.floor(info.width / STEP);
const H = Math.floor(info.height / STEP);
const wet = new Uint8Array(W * H);
for (let r = 0; r < H; r++)
  for (let c = 0; c < W; c++) {
    let s = 0;
    for (let dy = 0; dy < STEP; dy++) for (let dx = 0; dx < STEP; dx++) s += data[((r * STEP + dy) * info.width + c * STEP + dx) * info.channels];
    wet[r * W + c] = s / (STEP * STEP) >= 128 ? 1 : 0;
  }
// Cell centre in world metres.
const cx = (c) => meta.northWest.x + (c + 0.5) * CELL;
const cy = (r) => meta.northWest.y - (r + 0.5) * CELL;

// Only the water connected to the river (salt pans and ponds stay still).
const seen = new Uint8Array(W * H);
{
  const c0 = Math.floor((0 - meta.northWest.x) / CELL);
  const r0 = Math.floor((meta.northWest.y - 0) / CELL);
  const stack = [r0 * W + c0];
  while (stack.length) {
    const i = stack.pop();
    if (seen[i] || !wet[i]) continue;
    seen[i] = 1;
    const c = i % W;
    const r = (i / W) | 0;
    if (c > 0) stack.push(i - 1);
    if (c < W - 1) stack.push(i + 1);
    if (r > 0) stack.push(i - W);
    if (r < H - 1) stack.push(i + W);
  }
}
// A guessed depth: 2 m at the shore, 3 m deeper for every 100 m out, up to 30 m in the
// channel from the bar to Barreiro and 5 m in the inner bay, blending between the two
// longitudes below.
const DEEP_WEST_OF = -9.13;
const SHALLOW_EAST_OF = -9.04;
const dist = new Float64Array(W * H).fill(Infinity);
{
  // Distance to land, in cells (two passes of a chamfer transform).
  for (let i = 0; i < W * H; i++) if (!seen[i]) dist[i] = 0;
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      const i = r * W + c;
      if (c > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
      if (r > 0) dist[i] = Math.min(dist[i], dist[i - W] + 1);
      if (r > 0 && c > 0) dist[i] = Math.min(dist[i], dist[i - W - 1] + 1.414);
      if (r > 0 && c < W - 1) dist[i] = Math.min(dist[i], dist[i - W + 1] + 1.414);
    }
  for (let r = H - 1; r >= 0; r--)
    for (let c = W - 1; c >= 0; c--) {
      const i = r * W + c;
      if (c < W - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
      if (r < H - 1) dist[i] = Math.min(dist[i], dist[i + W] + 1);
      if (r < H - 1 && c < W - 1) dist[i] = Math.min(dist[i], dist[i + W + 1] + 1.414);
      if (r < H - 1 && c > 0) dist[i] = Math.min(dist[i], dist[i + W - 1] + 1.414);
    }
}
const depth = new Float64Array(W * H);
for (let r = 0; r < H; r++)
  for (let c = 0; c < W; c++) {
    const i = r * W + c;
    const k = Math.min(1, Math.max(0, (cx(c) - xOfLon(DEEP_WEST_OF)) / (xOfLon(SHALLOW_EAST_OF) - xOfLon(DEEP_WEST_OF))));
    const cap = cy(r) < yOfLat(NORTH_OF_LAT) ? 30 : 30 + (5 - 30) * k;
    depth[i] = Math.min(cap, 2 + 3 * dist[i]);
  }

// Unknowns: connected water, except on the west and south edges of the map (the open sea,
// phi = 0). On the north edge the river goes on upstream: no flow across it.
const id = new Int32Array(W * H).fill(-1);
let n = 0;
for (let r = 0; r < H - 1; r++) for (let c = 1; c < W; c++) if (seen[r * W + c]) id[r * W + c] = n++;
const inside = (r, c) => r >= 0 && c >= 0 && r < H && c < W;
const b = new Float64Array(n);
for (let r = 0; r < H; r++)
  for (let c = 0; c < W; c++) {
    const k = id[r * W + c];
    if (k >= 0 && cx(c) > xOfLon(EAST_OF_LON) && cy(r) > yOfLat(NORTH_OF_LAT)) b[k] = 1;
  }

// --- Solve: conjugate gradients on the 5-point Laplacian (land: no flow; edge: phi = 0) ----
const nbr = [];
const diag = new Float64Array(n);
for (let r = 0; r < H; r++)
  for (let c = 0; c < W; c++) {
    const k = id[r * W + c];
    if (k < 0) continue;
    const list = [];
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      if (!inside(r + dr, c + dc)) continue; // the north and east edges: no flow
      const j = (r + dr) * W + c + dc;
      if (!seen[j]) continue; // land: no flow
      const h = (depth[r * W + c] + depth[j]) / 2; // the depth on the face between them
      diag[k] += h;
      if (id[j] >= 0) list.push([id[j], h]); // else the sea edge, phi = 0
    }
    nbr[k] = list;
  }
const mul = (x, out) => {
  for (let k = 0; k < n; k++) {
    let s = diag[k] * x[k];
    for (const [j, h] of nbr[k]) s -= h * x[j];
    out[k] = s;
  }
};
const phi = new Float64Array(n);
const res = Float64Array.from(b);
const z = res.map((v, k) => v / diag[k]);
const p = Float64Array.from(z);
const Ap = new Float64Array(n);
let rz = res.reduce((s, v, k) => s + v * z[k], 0);
const bNorm = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
let it = 0;
for (; it < 20000; it++) {
  mul(p, Ap);
  let pAp = 0;
  for (let k = 0; k < n; k++) pAp += p[k] * Ap[k];
  const alpha = rz / pAp;
  let rr = 0;
  for (let k = 0; k < n; k++) {
    phi[k] += alpha * p[k];
    res[k] -= alpha * Ap[k];
    rr += res[k] * res[k];
  }
  if (Math.sqrt(rr) < 1e-7 * bNorm) break;
  let rz2 = 0;
  for (let k = 0; k < n; k++) {
    z[k] = res[k] / diag[k];
    rz2 += res[k] * z[k];
  }
  const beta = rz2 / rz;
  rz = rz2;
  for (let k = 0; k < n; k++) p[k] = z[k] + beta * p[k];
}
console.log(`${n} cells, ${it} iterations`);

// --- Flow = -grad(phi), out of the estuary (the ebb) -----------------------------------------
const at = (r, c) => {
  const i = r * W + c;
  return id[i] >= 0 ? phi[id[i]] : 0;
};
const ve = new Float64Array(W * H);
const vn = new Float64Array(W * H);
for (let r = 0; r < H; r++)
  for (let c = 0; c < W; c++) {
    const i = r * W + c;
    if (id[i] < 0) continue;
    const here = at(r, c);
    // Across the shore there is no flow: take the cell's own value there.
    const side = (dr, dc) => (inside(r + dr, c + dc) && seen[(r + dr) * W + c + dc] ? at(r + dr, c + dc) : here);
    ve[i] = -(side(0, 1) - side(0, -1)) / 2;
    vn[i] = (side(-1, 0) - side(1, 0)) / -2; // row 0 is north
  }

// Scale: the fastest stream on the line of the Ponte 25 de Abril is BRIDGE_SPEED.
const bridge = meta.bridges['Ponte 25 de Abril'].points;
let peak = 0;
for (let s = 0; s < bridge.length - 1; s++)
  for (let t = 0; t <= 1; t += 0.01) {
    const x = bridge[s][0] + (bridge[s + 1][0] - bridge[s][0]) * t;
    const y = bridge[s][1] + (bridge[s + 1][1] - bridge[s][1]) * t;
    const c = Math.floor((x - meta.northWest.x) / CELL);
    const r = Math.floor((meta.northWest.y - y) / CELL);
    const i = r * W + c;
    if (id[i] >= 0) peak = Math.max(peak, Math.hypot(ve[i], vn[i]));
  }
const k = BRIDGE_SPEED / peak;
let top = 0;
for (let i = 0; i < W * H; i++) {
  ve[i] *= k;
  vn[i] *= k;
  top = Math.max(top, Math.hypot(ve[i], vn[i]));
}
// Odd narrow gaps can come out too fast: cap at 4 knots.
const MAX = 4 * KNOT;
{
  let at = 0;
  for (let i = 0; i < W * H; i++) if (Math.hypot(ve[i], vn[i]) === top) at = i;
  const lon = meta.origin.lon + cx(at % W) / M_PER_DEG_LON;
  const lat = meta.origin.lat + cy((at / W) | 0) / M_PER_DEG_LAT;
  console.log(`fastest before the cap ${(top / KNOT).toFixed(1)} kn at ${lat.toFixed(3)}, ${lon.toFixed(3)}`);
}
const rgb = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) {
  let e = ve[i];
  let nn = vn[i];
  const s = Math.hypot(e, nn);
  if (s > MAX) {
    e *= MAX / s;
    nn *= MAX / s;
  }
  rgb[i * 3] = Math.round(128 + (e / MAX) * 127);
  rgb[i * 3 + 1] = Math.round(128 + (nn / MAX) * 127);
  rgb[i * 3 + 2] = seen[i] ? 255 : 0;
}
// A few figures to check against what sailors know.
const sample = (name, lat, lon) => {
  const c = Math.floor((xOfLon(lon) - meta.northWest.x) / CELL);
  const r = Math.floor((meta.northWest.y - yOfLat(lat)) / CELL);
  const i = r * W + c;
  const s = Math.min(MAX, Math.hypot(ve[i], vn[i]));
  const dir = ((Math.atan2(ve[i], vn[i]) * 180) / Math.PI + 360) % 360;
  console.log(`  ${name.padEnd(28)} ${(s / KNOT).toFixed(1)} kn towards ${dir.toFixed(0)}°`);
};
console.log('ebb stream:');
sample('Bugio (the bar)', 38.66, -9.29);
sample('off Belém', 38.69, -9.21);
sample('off Terreiro do Paço', 38.704, -9.135);
sample('off Barreiro', 38.675, -9.09);
sample('Mar da Palha', 38.73, -9.06);
sample('off Montijo', 38.70, -8.99);
sample('off Moita', 38.66, -9.0);
sample('Montijo channel', 38.695, -9.05);
sample('off Alcochete', 38.75, -8.98);
sample('off Seixal', 38.655, -9.1);
sample('off Cascais', 38.68, -9.42);

function png(width, height, data) {
  const table = Array.from({ length: 256 }, (_, m) => {
    let c = m;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const x of buf) c = table[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, d) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(type), d]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) data.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
writeFileSync(new URL('tagus-current.png', MAP), png(W, H, rgb));
writeFileSync(
  new URL('tagus-current.json', MAP),
  JSON.stringify({ source: 'scripts/tide-currents.mjs (from the land/water map)', cellSize: CELL, width: W, height: H, northWest: meta.northWest, maxSpeed: MAX, ebbUnderBridge: BRIDGE_SPEED }, null, 1) + '\n',
);
console.log(`wrote tagus-current.png (${W} x ${H}) and tagus-current.json`);
