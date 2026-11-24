// Land cover for a sailing area's map, from ESA WorldCover 2021 (10 m; © ESA WorldCover
// project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover
// consortium; CC BY 4.0).
//
//   npm install --no-save geotiff@3.0.5
//   node scripts/fetch-landcover.mjs [--area tejo]
//
// Reads the map grid from src/assets/map/<file>.json (written by fetch-map.mjs), looks at the
// sixteen 10 m pixels in every 40 m cell and writes how much of the cell is of each kind:
//   src/assets/map/<file>-cover.png  R = built up, G = trees, B = fields (crops)
//                                    (0..255 = 0..100 % of the land in the cell); the rest
//                                    is grass, scrub, bare ground or marsh
//   <file>.json "cover"              grid size and cell size
// The game paints the land with it (src/engine/mapView.ts). Only the windows needed are read
// from the cloud-optimised files (HTTP range requests).

import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fromUrl } from 'geotiff';
import { areaFromArgs } from './map-areas.mjs';

const AREA = areaFromArgs();
const OUT_DIR = new URL('../src/assets/map/', import.meta.url);
const CELL = 40; // m, as the heights
const SUB = 4; // samples per cell side (10 m apart, the source's own pixels)

const meta = JSON.parse(readFileSync(new URL(`${AREA.file}.json`, OUT_DIR), 'utf8'));
const { origin, northWest, cellSize, bbox } = meta;
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON = 111320 * Math.cos((origin.lat * Math.PI) / 180);
const toLatLon = (x, y) => [origin.lat + y / M_PER_DEG_LAT, origin.lon + x / M_PER_DEG_LON];
const W = Math.ceil((meta.width * cellSize) / CELL);
const H = Math.ceil((meta.height * cellSize) / CELL);

// WorldCover classes -> output channel (0 built, 1 trees, 2 fields; -1 the rest). No alpha
// channel: browsers may clear the colours where it is zero.
const CHANNEL = { 10: 1, 20: -1, 30: -1, 40: 2, 50: 0, 60: -1, 70: -1, 80: -1, 90: -1, 95: 1, 100: -1 };

// --- The 3° tiles that cover the map, read only over the map's window ------------------------
const tileKey = (lat, lon) => {
  const la = Math.floor(lat / 3) * 3;
  const lo = Math.floor(lon / 3) * 3;
  return `${la >= 0 ? 'N' : 'S'}${String(Math.abs(la)).padStart(2, '0')}${lo >= 0 ? 'E' : 'W'}${String(Math.abs(lo)).padStart(3, '0')}`;
};
const keys = new Set();
for (let lat = bbox.south; lat < bbox.north + 3; lat += 3) for (let lon = bbox.west; lon < bbox.east + 3; lon += 3) keys.add(tileKey(Math.min(lat, bbox.north), Math.min(lon, bbox.east)));
const tiles = new Map();
for (const key of keys) {
  const url = `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_${key}_Map.tif`;
  console.log(`reading ${url}`);
  const tiff = await fromUrl(url);
  const image = await tiff.getImage();
  const [west, south, east, north] = image.getBoundingBox();
  const w = image.getWidth();
  const h = image.getHeight();
  // The part of the tile inside the map (plus a pixel).
  const px = (lon) => Math.floor(((lon - west) / (east - west)) * w);
  const py = (lat) => Math.floor(((north - lat) / (north - south)) * h);
  const x0 = Math.max(0, px(bbox.west) - 1);
  const x1 = Math.min(w, px(bbox.east) + 2);
  const y0 = Math.max(0, py(bbox.north) - 1);
  const y1 = Math.min(h, py(bbox.south) + 2);
  if (x1 <= x0 || y1 <= y0) continue;
  const [data] = await image.readRasters({ window: [x0, y0, x1, y1] });
  tiles.set(key, { west, east, north, south, w, h, x0, y0, ww: x1 - x0, data });
  console.log(`  ${x1 - x0} x ${y1 - y0} pixels`);
}

function classAt(lat, lon) {
  const t = tiles.get(tileKey(lat, lon));
  if (!t) return 80;
  const x = Math.floor(((lon - t.west) / (t.east - t.west)) * t.w) - t.x0;
  const y = Math.floor(((t.north - lat) / (t.north - t.south)) * t.h) - t.y0;
  if (x < 0 || y < 0 || x >= t.ww) return 80;
  return t.data[y * t.ww + x] ?? 80;
}

// --- Shares per cell -----------------------------------------------------------------------
const rgb = Buffer.alloc(W * H * 3);
const totals = [0, 0, 0];
let land = 0;
for (let j = 0; j < H; j++) {
  for (let i = 0; i < W; i++) {
    const n = [0, 0, 0];
    let count = 0;
    for (let b = 0; b < SUB; b++)
      for (let a = 0; a < SUB; a++) {
        const x = northWest.x + (i + (a + 0.5) / SUB) * CELL;
        const y = northWest.y - (j + (b + 0.5) / SUB) * CELL;
        const c = classAt(...toLatLon(x, y));
        if (c === 80) continue; // water: the share is of the land only
        count++;
        const ch = CHANNEL[c] ?? -1;
        if (ch >= 0) n[ch]++;
      }
    const o = (j * W + i) * 3;
    for (let k = 0; k < 3; k++) {
      rgb[o + k] = count ? Math.round((255 * n[k]) / count) : 0;
      totals[k] += n[k];
    }
    land += count;
  }
}
const pct = (v) => `${((100 * v) / Math.max(1, land)).toFixed(0)} %`;
console.log(`land: built ${pct(totals[0])}, trees ${pct(totals[1])}, fields ${pct(totals[2])}`);

function png(width, height, data) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const td = Buffer.concat([Buffer.from(type), body]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) data.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync(new URL(`${AREA.file}-cover.png`, OUT_DIR), png(W, H, rgb));
meta.cover = {
  source: 'ESA WorldCover 10 m 2021 v200 (© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium; CC BY 4.0)',
  cellSize: CELL,
  width: W,
  height: H,
};
writeFileSync(new URL(`${AREA.file}.json`, OUT_DIR), JSON.stringify(meta, null, 2) + '\n');
console.log(`wrote ${AREA.file}-cover.png (${W} x ${H})`);
