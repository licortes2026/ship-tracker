#!/usr/bin/env node
/*
 * Copyright 2026 Luis I. Cortes
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/*
 * World Odyssey track server.
 * Listens to aisstream.io for MMSI 311000410, appends every distinct fix to
 * data/positions.jsonl, and serves the accumulated track plus the tracker page.
 *
 * Run:  node server.js        Then open http://localhost:8787
 */

"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const zlib = require("zlib");
const WebSocket = require("ws");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const LOG = path.join(DATA_DIR, "positions.jsonl");
const PUBLIC = path.join(ROOT, "public");

const MMSI = process.env.ODYSSEY_MMSI || "311000410";
const PORT = parseInt(process.env.ODYSSEY_PORT || "8787", 10);
const KEY = process.env.AISSTREAM_API_KEY || readKeyFile();

// A fix is kept if the ship moved more than this, or this much time passed.
const MIN_NM = 0.5;
const MIN_MINUTES = 10;

function readKeyFile(){
  try { return fs.readFileSync(path.join(ROOT, ".aisstream-key"), "utf8").trim(); }
  catch (e) { return ""; }
}

if (!KEY){
  console.error("No API key. Put your free aisstream.io key in .aisstream-key or set AISSTREAM_API_KEY.");
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- track store ---------- */

let track = [];
let meta = { name: "WORLD ODYSSEY", destination: null, eta: null, sog: null, cog: null, draught: null };
let connected = false;
let lastMessageAt = null;

function loadTrack(){
  if (!fs.existsSync(LOG)) return;
  const lines = fs.readFileSync(LOG, "utf8").split("\n");
  for (const line of lines){
    if (!line.trim()) continue;
    try {
      const p = JSON.parse(line);
      if (typeof p.lat === "number" && typeof p.lon === "number") track.push(p);
    } catch (e) { /* skip a torn line */ }
  }
  track.sort((a, b) => a.t - b.t);
  console.log(`Loaded ${track.length} stored fixes.`);
}

function nm(a, b){
  const R = 3440.065, d = Math.PI / 180;
  const la1 = a.lat * d, la2 = b.lat * d;
  const dla = la2 - la1, dlo = (b.lon - a.lon) * d;
  const h = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function addFix(fix){
  const last = track[track.length - 1];
  if (last){
    const moved = nm(last, fix);
    const mins = (fix.t - last.t) / 60000;
    if (moved < MIN_NM && mins < MIN_MINUTES) return false;
    if (moved > 600 && mins < 60) return false; // implausible jump, drop it
  }
  track.push(fix);
  fs.appendFile(LOG, JSON.stringify(fix) + "\n", () => {});
  const d = new Date(fix.t).toISOString().replace("T", " ").slice(0, 16);
  console.log(`fix ${d}  ${fix.lat.toFixed(4)}, ${fix.lon.toFixed(4)}  ${fix.sog ?? "?"} kt`);
  return true;
}

/* ---------- aisstream listener ---------- */

let ws = null, backoff = 2000, heartbeat = null;

function subscribe(){
  ws.send(JSON.stringify({
    APIKey: KEY,
    BoundingBoxes: [[[-90, -180], [90, 180]]],
    FiltersShipMMSI: [String(MMSI)],
    FilterMessageTypes: ["PositionReport", "ShipStaticData"]
  }));
}

function connect(){
  ws = new WebSocket("wss://stream.aisstream.io/v0/stream", { perMessageDeflate: true });

  ws.on("open", () => {
    connected = true; backoff = 2000;
    subscribe();
    console.log(`Listening for MMSI ${MMSI}.`);
    clearInterval(heartbeat);
    heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.ping(); }, 30000);
  });

  ws.on("message", (raw) => {
    lastMessageAt = Date.now();
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }

    if (msg.MessageType === "PositionReport"){
      const r = msg.Message.PositionReport;
      if (typeof r.Latitude !== "number" || typeof r.Longitude !== "number") return;
      if (Math.abs(r.Latitude) > 90 || Math.abs(r.Longitude) > 180) return;
      const t = msg.MetaData && msg.MetaData.time_utc
        ? Date.parse(msg.MetaData.time_utc.replace(" +0000 UTC", "Z").replace(" ", "T"))
        : Date.now();
      meta.sog = r.Sog; meta.cog = r.Cog;
      addFix({
        t: Number.isFinite(t) ? t : Date.now(),
        lat: r.Latitude, lon: r.Longitude,
        sog: r.Sog, cog: r.Cog, hdg: r.TrueHeading
      });
    }

    if (msg.MessageType === "ShipStaticData"){
      const s = msg.Message.ShipStaticData;
      if (s.Name) meta.name = String(s.Name).trim();
      if (s.Destination) meta.destination = String(s.Destination).trim();
      if (s.MaximumStaticDraught) meta.draught = s.MaximumStaticDraught;
      if (s.Eta) meta.eta = s.Eta;
    }
  });

  ws.on("close", () => { connected = false; retry("closed"); });
  ws.on("error", (e) => { connected = false; console.error("stream error:", e.message); });
}

function retry(why){
  clearInterval(heartbeat);
  console.log(`Stream ${why}. Reconnecting in ${Math.round(backoff / 1000)}s.`);
  setTimeout(connect, backoff);
  backoff = Math.min(backoff * 2, 120000);
}

/* ---------- http ---------- */

// Changes whenever index.html is redeployed, so open pages know to reload themselves.
function buildId(){
  try { const st = fs.statSync(path.join(PUBLIC, "index.html")); return Math.round(st.mtimeMs); }
  catch (e) { return 0; }
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
                ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
                ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };

// Text compresses enormously here: the page is 158KB raw and about 53KB gzipped.
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|manifest))/;

function wantsGzip(req){
  return /\bgzip\b/.test(req.headers["accept-encoding"] || "");
}

function json2(res, req, body, code){ return json(res, body, code, req); }

function json(res, body, code, req){
  const s = JSON.stringify(body);
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  };
  if (req && wantsGzip(req) && s.length > 1024){
    const buf = zlib.gzipSync(s);
    headers["Content-Encoding"] = "gzip";
    headers["Content-Length"] = buf.length;
    res.writeHead(code || 200, headers);
    return res.end(buf);
  }
  headers["Content-Length"] = Buffer.byteLength(s);
  res.writeHead(code || 200, headers);
  res.end(s);
}

const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];

  // Tiny. This is what an open page asks for on its hourly tick.
  if (url === "/position.json"){
    const latest = track[track.length - 1] || null;
    return json2(res, req, {
      mmsi: MMSI,
      build: buildId(),
      connected,
      incremental: true,          // this host can serve ?since=, so ask for every new fix
      count: track.length,
      lastT: latest ? latest.t : 0,
      latest,
      meta
    });
  }

  // The whole track, or only what is new. ?since= for incremental, ?max= to thin it.
  if (url === "/track.json"){
    const q = new URLSearchParams((req.url.split("?")[1] || ""));
    const since = parseInt(q.get("since") || "0", 10) || 0;
    const max = Math.max(2, parseInt(q.get("max") || "1500", 10));

    let pts = since ? track.filter(p => p.t > since) : track.slice();

    // Thin evenly for display, but never drop the newest fix.
    let thinned = false;
    if (pts.length > max){
      const step = Math.ceil(pts.length / max);
      const out = [];
      for (let i = 0; i < pts.length; i += step) out.push(pts[i]);
      if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
      pts = out;
      thinned = true;
    }

    return json2(res, req, {
      mmsi: MMSI,
      build: buildId(),
      connected,
      lastMessageAt,
      count: track.length,
      returned: pts.length,
      since,
      thinned,
      lastT: track.length ? track[track.length - 1].t : 0,
      meta,
      points: pts.map(p => ({ t: p.t, lat: p.lat, lon: p.lon, sog: p.sog, cog: p.cog }))
    });
  }

  if (url === "/status.json"){
    return json2(res, req, {
      connected, lastMessageAt, fixes: track.length,
      latest: track[track.length - 1] || null, meta
    });
  }

  const file = path.join(PUBLIC, url === "/" ? "index.html" : url.replace(/^\/+/, ""));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end("no"); }

  fs.stat(file, (statErr, st) => {
    if (statErr || !st.isFile()){ res.writeHead(404); return res.end("not found"); }

    const modified = st.mtime.toUTCString();
    const tag = '"' + st.size.toString(16) + "-" + Math.round(st.mtimeMs).toString(16) + '"';
    const ext = path.extname(file);
    const type = TYPES[ext] || "application/octet-stream";
    // The page must be revalidated so a redeploy reaches open tabs. Everything else
    // is an immutable asset: fetch it once, keep it for a year.
    const isPage = (ext === ".html");
    const headers = {
      "Content-Type": type,
      "Cache-Control": isPage ? "no-cache, must-revalidate" : "public, max-age=31536000, immutable",
      "Last-Modified": modified,
      "ETag": tag
    };

    // Unchanged? Answer in a few bytes instead of resending the page.
    const since = req.headers["if-modified-since"];
    const none = req.headers["if-none-match"];
    if ((none && none === tag) || (since && Date.parse(since) >= Math.floor(st.mtimeMs / 1000) * 1000)){
      res.writeHead(304, headers);
      return res.end();
    }

    fs.readFile(file, (err, buf) => {
      if (err){ res.writeHead(404); return res.end("not found"); }
      if (COMPRESSIBLE.test(type) && wantsGzip(req) && buf.length > 1024){
        buf = zlib.gzipSync(buf);
        headers["Content-Encoding"] = "gzip";
        headers["Vary"] = "Accept-Encoding";
      }
      headers["Content-Length"] = buf.length;
      res.writeHead(200, headers);
      res.end(buf);
    });
  });
});

loadTrack();
server.listen(PORT, () => {
  console.log(`Tracker at http://localhost:${PORT}`);
  console.log(`Track log: ${LOG}`);
});
connect();

process.on("SIGINT", () => { console.log("\nStopping. Track is saved."); process.exit(0); });
