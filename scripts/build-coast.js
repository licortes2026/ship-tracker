#!/usr/bin/env node
// Builds docs/coast/iberia.json: a fine coastline, a land fill and place labels for the
// Leixoes to Tangier leg, from Natural Earth 1:10m (public domain).
//
//   node scripts/build-coast.js <dir holding the unzipped ne_10m_* folders> [out.json]
//
// The page draws in degrees (x = lon, y = -lat), so paths are written in those units,
// quantised to 0.001 degree (about 100 m) and delta encoded. No dependencies: the
// shapefile and dbf readers below cover only the record types Natural Earth uses.
"use strict";
const fs = require("fs");
const path = require("path");

const NE = process.env.NE_DIR || process.argv[2];
if (!NE) { console.error("usage: node build-coast.js <NE dir> [out.json]"); process.exit(1); }
const OUT = process.argv[3] || path.join(__dirname, "..", "docs", "coast", "iberia.json");

const BBOX = [-12.0, 34.5, -4.3, 42.2];         // W S E N, degrees
const Q = 1000;                                   // 0.001 degree
const LODS = [{ eps: 0.010, maxSpan: 99 }, { eps: 0.0015, maxSpan: 3.5 }];
const NEAR_KM = 12;                               // a place must be this close to the sea
const K = Math.cos(38 * Math.PI / 180);           // squashes longitude for distance tests

// ---------- readers ----------

function readShp(file, bb) {
  const b = fs.readFileSync(file), out = [];
  let off = 100;
  while (off + 8 <= b.length) {
    const s = off + 8;
    off = s + b.readInt32BE(off + 4) * 2;
    const t = b.readInt32LE(s);
    if (![3, 5, 13, 15].includes(t)) continue;
    const xmin = b.readDoubleLE(s + 4), ymin = b.readDoubleLE(s + 12);
    const xmax = b.readDoubleLE(s + 20), ymax = b.readDoubleLE(s + 28);
    if (xmax < bb[0] || xmin > bb[2] || ymax < bb[1] || ymin > bb[3]) continue;
    const nParts = b.readInt32LE(s + 36), nPts = b.readInt32LE(s + 40);
    const starts = [];
    for (let i = 0; i < nParts; i++) starts.push(b.readInt32LE(s + 44 + 4 * i));
    const p0 = s + 44 + 4 * nParts;
    for (let i = 0; i < nParts; i++) {
      const a = starts[i], z = i + 1 < nParts ? starts[i + 1] : nPts, pts = [];
      for (let k = a; k < z; k++) pts.push([b.readDoubleLE(p0 + 16 * k), b.readDoubleLE(p0 + 16 * k + 8)]);
      out.push(pts);
    }
  }
  return out;
}

function readPoints(file) {
  const b = fs.readFileSync(file), out = [];
  let off = 100;
  while (off + 8 <= b.length) {
    const s = off + 8;
    off = s + b.readInt32BE(off + 4) * 2;
    out.push(b.readInt32LE(s) === 1 ? [b.readDoubleLE(s + 4), b.readDoubleLE(s + 12)] : null);
  }
  return out;
}

function readDbf(file) {
  const b = fs.readFileSync(file);
  const n = b.readUInt32LE(4), hl = b.readUInt16LE(8), rl = b.readUInt16LE(10);
  const fields = [];
  for (let o = 32, pos = 1; b[o] !== 0x0d; o += 32) {
    fields.push({ name: b.toString("latin1", o, o + 11).replace(/\0.*$/, ""), pos, len: b[o + 16] });
    pos += b[o + 16];
  }
  const rows = [];
  for (let i = 0; i < n; i++) {
    const r = hl + i * rl, row = {};
    for (const f of fields) row[f.name] = b.toString("utf8", r + f.pos, r + f.pos + f.len).replace(/\0/g, "").trim();
    rows.push(row);
  }
  return rows;
}

// ---------- clipping ----------

function clipSeg(p, q, bb) {                      // Liang-Barsky
  let t0 = 0, t1 = 1;
  const dx = q[0] - p[0], dy = q[1] - p[1];
  const chk = (pp, qq) => {
    if (pp === 0) return qq >= 0;
    const r = qq / pp;
    if (pp < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  return chk(-dx, p[0] - bb[0]) && chk(dx, bb[2] - p[0]) && chk(-dy, p[1] - bb[1]) && chk(dy, bb[3] - p[1])
    ? [t0, t1] : null;
}

function clipLine(pts, bb) {
  const out = []; let cur = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1], c = clipSeg(p, q, bb);
    if (!c) { cur = null; continue; }
    const a = [p[0] + c[0] * (q[0] - p[0]), p[1] + c[0] * (q[1] - p[1])];
    const z = [p[0] + c[1] * (q[0] - p[0]), p[1] + c[1] * (q[1] - p[1])];
    if (!cur || c[0] > 0) { cur = [a]; out.push(cur); }
    cur.push(z);
    if (c[1] < 1) cur = null;
  }
  return out;
}

function clipPoly(ring, bb) {                     // Sutherland-Hodgman
  let pts = ring.slice();
  const f = pts[0], l = pts[pts.length - 1];
  if (f[0] === l[0] && f[1] === l[1]) pts.pop();
  const edges = [
    { in: p => p[0] >= bb[0], x: (a, b) => { const t = (bb[0] - a[0]) / (b[0] - a[0]); return [bb[0], a[1] + t * (b[1] - a[1])]; } },
    { in: p => p[0] <= bb[2], x: (a, b) => { const t = (bb[2] - a[0]) / (b[0] - a[0]); return [bb[2], a[1] + t * (b[1] - a[1])]; } },
    { in: p => p[1] >= bb[1], x: (a, b) => { const t = (bb[1] - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), bb[1]]; } },
    { in: p => p[1] <= bb[3], x: (a, b) => { const t = (bb[3] - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), bb[3]]; } },
  ];
  for (const e of edges) {
    const inp = pts; pts = [];
    if (!inp.length) break;
    let s = inp[inp.length - 1];
    for (const p of inp) {
      if (e.in(p)) { if (!e.in(s)) pts.push(e.x(s, p)); pts.push(p); }
      else if (e.in(s)) pts.push(e.x(s, p));
      s = p;
    }
  }
  return pts;
}

// ---------- simplification ----------

function dp(pts, eps) {                           // Douglas-Peucker on an open polyline
  const n = pts.length;
  if (n < 3) return pts.slice();
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, z] = stack.pop();
    const ax = pts[a][0] * K, ay = pts[a][1], dx = pts[z][0] * K - ax, dy = pts[z][1] - ay, L2 = dx * dx + dy * dy;
    let best = -1, bi = -1;
    for (let i = a + 1; i < z; i++) {
      const px = pts[i][0] * K - ax, py = pts[i][1] - ay;
      const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / L2));
      const d = Math.hypot(px - t * dx, py - t * dy);
      if (d > best) { best = d; bi = i; }
    }
    if (best > eps) { keep[bi] = 1; stack.push([a, bi], [bi, z]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// A closed ring has identical ends, so its baseline has zero length and every point
// looks equally far from it. Split it at the vertex farthest from the start first.
function simplifyRing(ring, eps) {
  const r = ring.slice();
  const f = r[0], l = r[r.length - 1];
  if (f[0] === l[0] && f[1] === l[1]) r.pop();
  if (r.length < 4) return r;
  let bi = 0, bd = -1;
  for (let i = 1; i < r.length; i++) {
    const d = Math.hypot((r[i][0] - r[0][0]) * K, r[i][1] - r[0][1]);
    if (d > bd) { bd = d; bi = i; }
  }
  const A = dp(r.slice(0, bi + 1), eps), B = dp(r.slice(bi).concat([r[0]]), eps);
  return A.slice(0, -1).concat(B.slice(0, -1));
}

// ---------- path text ----------

const qz = v => Math.round(v * Q);
function fmt(n) {                                 // integer thousandths to the shortest decimal
  if (n === 0) return "0";
  const a = Math.abs(n), i = Math.floor(a / Q), f = a % Q;
  return (n < 0 ? "-" : "") + (i ? i : f ? "" : "0") + (f ? "." + String(f).padStart(3, "0").replace(/0+$/, "") : "");
}
function pathOf(pts, closed) {
  const P = [];
  for (const p of pts) {
    const c = [qz(p[0]), qz(-p[1])];
    if (!P.length || c[0] !== P[P.length - 1][0] || c[1] !== P[P.length - 1][1]) P.push(c);
  }
  if (P.length < 2) return "";
  let d = "M" + fmt(P[0][0]) + " " + fmt(P[0][1]) + "l";
  for (let i = 1; i < P.length; i++) {
    for (const t of [fmt(P[i][0] - P[i - 1][0]), fmt(P[i][1] - P[i - 1][1])]) {
      d += (t[0] === "-" || d.endsWith("l") ? "" : " ") + t;
    }
  }
  return d + (closed ? "z" : "");
}

// ---------- geometry helpers for places ----------

function segDistKm(p, a, b) {
  const kx = 111.32 * Math.cos(p[1] * Math.PI / 180), ky = 110.57;
  const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}
function nearestCoastKm(p, lines) {
  let best = Infinity;
  for (const l of lines) for (let i = 0; i < l.length - 1; i++) best = Math.min(best, segDistKm(p, l[i], l[i + 1]));
  return best;
}
function inLand(p, rings) {                       // even-odd, so holes work
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i], b = r[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
  }
  return inside;
}

// ---------- build ----------

const t0 = Date.now();
const coastRaw = readShp(path.join(NE, "ne_10m_coastline", "ne_10m_coastline.shp"), BBOX);
const landRaw = readShp(path.join(NE, "ne_10m_land", "ne_10m_land.shp"), BBOX);

let coastPieces = [];                             // {pts, closed}
for (const line of coastRaw) {
  const closed = line.length > 3 && line[0][0] === line[line.length - 1][0] && line[0][1] === line[line.length - 1][1];
  const pieces = clipLine(line, BBOX);
  if (pieces.length === 1 && closed && pieces[0].length === line.length) coastPieces.push({ pts: line, closed: true });
  else for (const p of pieces) if (p.length > 1) coastPieces.push({ pts: p, closed: false });
}
const landRings = landRaw.map(r => clipPoly(r, BBOX)).filter(r => r.length >= 3);

const lods = LODS.map(L => {
  const coastPaths = coastPieces.map(c => c.closed
    ? pathOf(simplifyRing(c.pts, L.eps), true)
    : pathOf(dp(c.pts, L.eps), false)).filter(Boolean);
  const landPaths = landRings.map(r => pathOf(simplifyRing(r, L.eps), true)).filter(Boolean);
  return { maxSpan: L.maxSpan, coast: coastPaths.join(""), land: landPaths.join(""), eps: L.eps };
});

// places
const fineCoast = coastPieces.map(c => dp(c.pts, 0.0015));
const fineLand = landRings.map(r => simplifyRing(r, 0.0015));
const pts = readPoints(path.join(NE, "ne_10m_populated_places_simple", "ne_10m_populated_places_simple.shp"));
const rows = readDbf(path.join(NE, "ne_10m_populated_places_simple", "ne_10m_populated_places_simple.dbf"));

function sideFor(p) {                             // label goes toward open water
  const score = dir => [0.08, 0.2, 0.4].reduce((s, d) => s + (inLand([p[0] + dir * d, p[1]], fineLand) ? 0 : 1), 0);
  return score(-1) > score(1) ? "w" : "e";
}
function rankOf(popK) { return popK >= 400 ? 1 : popK >= 100 ? 2 : popK >= 25 ? 3 : 4; }

const places = [], dropped = [];
rows.forEach((row, i) => {
  const p = pts[i];
  if (!p || p[0] < BBOX[0] + 0.2 || p[0] > BBOX[2] - 0.2 || p[1] < BBOX[1] + 0.2 || p[1] > BBOX[3] - 0.2) return;
  const popK = Math.round(Number(row.pop_max) / 1000);
  const km = nearestCoastKm(p, fineCoast);
  if (km > NEAR_KM) { if (popK >= 100) dropped.push(`${row.name} ${popK}k ${km.toFixed(0)} km inland`); return; }
  places.push({ name: row.name, lon: p[0], lat: p[1], pop: popK, km });
});

// Hand-set features Natural Earth has no point for. Each is checked against the data below.
const CAPES = [
  ["Cape St. Vincent", -8.9967, 37.0233, 2], ["Cabo da Roca", -9.4989, 38.7804, 2],
  ["Cape Espichel", -9.2144, 38.4186, 3], ["Cabo de Sines", -8.8875, 37.9491, 3],
  ["Cabo Carvoeiro", -9.4111, 39.3597, 3], ["Cape Trafalgar", -6.0333, 36.1833, 2],
  ["Cape Spartel", -5.9200, 35.7900, 2],
];
const SEAS = [["Gulf of Cádiz", -7.5, 36.4, 1]];

const warnings = [];
const out = places.sort((a, b) => b.pop - a.pop).map(p => {
  const c = [p.lon, p.lat];
  return [p.name, +p.lon.toFixed(3), +p.lat.toFixed(3), rankOf(p.pop), sideFor(c), "t", p.pop];
});
for (const [name, lon, lat, rank] of CAPES) {
  const km = nearestCoastKm([lon, lat], fineCoast);
  if (km > 3) warnings.push(`${name}: ${km.toFixed(1)} km from the coastline`);
  out.push([name, lon, lat, rank, sideFor([lon, lat]), "c", 0]);
}
for (const [name, lon, lat, rank] of SEAS) {
  if (inLand([lon, lat], fineLand)) warnings.push(`${name}: point is on land`);
  out.push([name, lon, lat, rank, "e", "s", 0]);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const json = JSON.stringify({
  v: 1, src: "Natural Earth 1:10m coastline, land and populated places (public domain)",
  bbox: BBOX, lods: lods.map(({ maxSpan, coast, land }) => ({ maxSpan, coast, land })), places: out,
});
fs.writeFileSync(OUT, json);

// ---------- report ----------
const gz = require("zlib").gzipSync(json).length;
console.log(`coastline pieces ${coastPieces.length}, land rings ${landRings.length}, raw vertices ` +
  `${coastRaw.reduce((n, l) => n + l.length, 0)} coast / ${landRaw.reduce((n, l) => n + l.length, 0)} land (before clipping)`);
lods.forEach((l, i) => console.log(`lod ${i} eps ${l.eps}: coast ${l.coast.length} B, land ${l.land.length} B`));
console.log(`places kept ${out.length} (${places.length} towns within ${NEAR_KM} km of the sea)`);
console.log(`file ${json.length} B, gzip ${gz} B, built in ${Date.now() - t0} ms -> ${OUT}`);
if (dropped.length) console.log("large places dropped as inland:\n  " + dropped.join("\n  "));
if (warnings.length) console.log("WARNINGS:\n  " + warnings.join("\n  "));
