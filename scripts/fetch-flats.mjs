#!/usr/bin/env node
// The mud and sand flats that dry at low tide, from OpenStreetMap, on the same 20 m grid as the
// area's water map (scripts/fetch-map.mjs).
//
//   node scripts/fetch-flats.mjs [--area tejo]       # download from the Overpass API
//   node scripts/fetch-flats.mjs --input osm.json   # use a saved Overpass response
//
// Output: src/assets/map/<file>-flats.png, R = 255 where the ground dries at low tide
// (wetland=tidalflat, natural=mud, natural=shoal; salt marsh is left as it is). Data ©
// OpenStreetMap contributors (ODbL).

import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { areaFromArgs } from './map-areas.mjs';

const AREA = areaFromArgs();
const meta = JSON.parse(readFileSync(new URL(`../src/assets/map/${AREA.file}.json`, import.meta.url)));
const { width: W, height: H, cellSize: CELL, northWest: NW, origin: ORIGIN } = meta;
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
// Cell coordinates (fractional), row 0 = north edge, as the water map.
const toCell = (lat, lon) => [((lon - ORIGIN.lon) * M_PER_DEG_LON - NW.x) / CELL, (NW.y - (lat - ORIGIN.lat) * M_PER_DEG_LAT) / CELL];

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

async function download() {
  const { south, west, north, east } = AREA.bbox;
  const b = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:180];
(
  way["wetland"="tidalflat"](${b});
  relation["wetland"="tidalflat"](${b});
  way["natural"="mud"](${b});
  relation["natural"="mud"](${b});
  way["natural"="shoal"](${b});
  relation["natural"="shoal"](${b});
);
out geom;`;
  for (const url of OVERPASS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`Overpass: ${url} (attempt ${attempt})`);
        const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), headers: { 'User-Agent': 'fragateiro-map-builder (github.com/Everyday-Sails/fragateiro)' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (e) {
        console.warn(`  failed: ${e.message}`);
        await new Promise((r) => setTimeout(r, 5000 * attempt));
      }
    }
  }
  throw new Error('All Overpass servers failed');
}

const flats = new Uint8Array(W * H);

/** Even-odd scanline fill of closed rings (multipolygons with holes). */
function fillRings(rings) {
  const edges = [];
  for (const ring of rings) for (let i = 0; i + 1 < ring.length; i++) edges.push([ring[i], ring[i + 1]]);
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const r of rings) for (const p of r) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(H - 1, Math.ceil(y1)); y++) {
    const yc = y + 0.5;
    const xs = [];
    for (const [a, b] of edges) if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(W - 1, Math.floor(xs[k + 1] - 0.5)); x++) flats[y * W + x] = 255;
  }
}

/** Join open member ways of a relation into closed rings. */
function joinRings(ways) {
  const open = ways.filter((w) => w.length > 1).map((w) => [...w]);
  const rings = [];
  const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  while (open.length) {
    let ring = open.pop();
    let grown = true;
    while (!same(ring[0], ring[ring.length - 1]) && grown) {
      grown = false;
      for (let i = 0; i < open.length; i++) {
        const w = open[i];
        const end = ring[ring.length - 1];
        if (same(w[0], end)) ring = ring.concat(w.slice(1));
        else if (same(w[w.length - 1], end)) ring = ring.concat([...w].reverse().slice(1));
        else continue;
        open.splice(i, 1);
        grown = true;
        break;
      }
    }
    if (same(ring[0], ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}

const args = process.argv.slice(2);
const inputIdx = args.indexOf('--input');
const osm = inputIdx >= 0 ? JSON.parse(readFileSync(args[inputIdx + 1], 'utf8')) : await download();
if (inputIdx < 0 && args.includes('--save')) writeFileSync(args[args.indexOf('--save') + 1], JSON.stringify(osm));
const cells = (geometry) => geometry.map((p) => toCell(p.lat, p.lon));
let n = 0;
for (const el of osm.elements ?? []) {
  if (el.type === 'way' && el.geometry?.length > 3) {
    fillRings([cells(el.geometry)]);
    n++;
  } else if (el.type === 'relation' && el.members) {
    const rings = joinRings(el.members.filter((m) => m.type === 'way' && m.geometry).map((m) => cells(m.geometry)));
    if (rings.length) {
      fillRings(rings);
      n++;
    }
  }
}

// How the flats sit on the water map: on water (the map's shore is the high-water line, as
// expected) or on land (the shore drawn at low water).
const mask = (await import('sharp')).default;
const { data, info } = await mask(new URL(`../src/assets/map/${AREA.file}-mask.png`, import.meta.url).pathname).raw().toBuffer({ resolveWithObject: true });
let onWater = 0;
let onLand = 0;
for (let i = 0; i < W * H; i++) if (flats[i]) (data[i * info.channels] >= 128 ? onWater++ : onLand++);
const km2 = (c) => ((c * CELL * CELL) / 1e6).toFixed(1);
console.log(`${n} flats: ${km2(onWater)} km² on the map's water, ${km2(onLand)} km² on its land`);

function png(width, height, gray) {
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
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw[y * (width * 3 + 1) + 1 + x * 3] = gray[y * width + x];
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
writeFileSync(new URL(`../src/assets/map/${AREA.file}-flats.png`, import.meta.url), png(W, H, flats));
console.log(`wrote ${AREA.file}-flats.png (${W} x ${H})`);
