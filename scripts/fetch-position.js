#!/usr/bin/env node
/*
 * Copyright 2026 Luis I. Cortes
 * Licensed under the Apache License, Version 2.0.
 *
 * Runs inside a GitHub Action. Opens a websocket to aisstream, listens for a
 * short window, and writes the newest fix into docs/. Nothing is kept running.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const KEY    = process.env.AISSTREAM_API_KEY;
const MMSI   = process.env.ODYSSEY_MMSI || "311000410";
const WINDOW = parseInt(process.env.LISTEN_SECONDS || "75", 10) * 1000;

const DOCS     = path.join(__dirname, "..", "docs");
const POSITION = path.join(DOCS, "position.json");
const TRACK    = path.join(DOCS, "track.json");
const LOG      = path.join(DOCS, "log.jsonl");   // append-only, never rewritten

// Nothing is ever discarded. One fix an hour for the whole voyage is at most
// ~2,500 points, which is under 200KB. The permanent record is log.jsonl,
// append-only; track.json is the same data shaped for the page.

if (!KEY){ console.error("No AISSTREAM_API_KEY. Add it as a repository secret."); process.exit(1); }

function readJSON(file, fallback){
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return fallback; }
}

function nm(a, b){
  const R = 3440.065, d = Math.PI / 180;
  const la1 = a.lat * d, la2 = b.lat * d;
  const dla = la2 - la1, dlo = (b.lon - a.lon) * d;
  const h = Math.sin(dla/2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo/2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// The log is the record. Rebuild track.json from it every run, so the two
// can never drift apart and a bad run cannot silently lose history.
function readLog(){
  try {
    return fs.readFileSync(LOG, "utf8").split("\n")
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch (e) { return null; } })
      .filter(p => p && typeof p.lat === "number" && typeof p.lon === "number")
      .sort((a, b) => a.t - b.t);
  } catch (e) { return []; }
}

const points = readLog();
const last = points[points.length - 1] || null;
console.log(`log holds ${points.length} fixes`);

let best = null, meta = {}, gotStatic = false;

const ws = new WebSocket("wss://stream.aisstream.io/v0/stream", { perMessageDeflate: true });
const timer = setTimeout(finish, WINDOW);

ws.on("open", () => {
  console.log(`listening ${WINDOW / 1000}s for MMSI ${MMSI}`);
  ws.send(JSON.stringify({
    APIKey: KEY,
    BoundingBoxes: [[[-90, -180], [90, 180]]],
    FiltersShipMMSI: [String(MMSI)],
    FilterMessageTypes: ["PositionReport", "ShipStaticData"]
  }));
});

ws.on("message", raw => {
  let msg; try { msg = JSON.parse(raw.toString()); } catch (e) { return; }

  if (msg.MessageType === "PositionReport"){
    const r = msg.Message.PositionReport;
    if (typeof r.Latitude !== "number" || typeof r.Longitude !== "number") return;
    if (Math.abs(r.Latitude) > 90 || Math.abs(r.Longitude) > 180) return;
    const t = msg.MetaData && msg.MetaData.time_utc
      ? Date.parse(msg.MetaData.time_utc.replace(" +0000 UTC", "Z").replace(" ", "T"))
      : Date.now();
    best = { t: Number.isFinite(t) ? t : Date.now(), lat: r.Latitude, lon: r.Longitude,
             sog: r.Sog, cog: r.Cog };
    console.log(`heard her: ${best.lat.toFixed(4)}, ${best.lon.toFixed(4)} @ ${best.sog} kt`);
    if (gotStatic) finish();            // have position and identity, no need to wait
  }

  if (msg.MessageType === "ShipStaticData"){
    const s = msg.Message.ShipStaticData;
    if (s.Name) meta.name = String(s.Name).trim();
    if (s.Destination) meta.destination = String(s.Destination).trim();
    gotStatic = true;
  }
});

ws.on("error", e => { console.error("stream error:", e.message); finish(); });

let done = false;
function finish(){
  if (done) return;
  done = true;
  clearTimeout(timer);
  try { ws.close(); } catch (e) {}

  fs.mkdirSync(DOCS, { recursive: true });

  if (!best){
    console.log("no report in this window: out of terrestrial range, or no receiver nearby");
    // Still refresh the timestamp so the page can say how long she has been quiet.
    const pos = readJSON(POSITION, {});
    pos.checkedAt = Date.now();
    pos.incremental = false;
    fs.writeFileSync(POSITION, JSON.stringify(pos, null, 1));
    process.exit(0);
  }

  const moved = last ? nm(last, best) : Infinity;
  const mins  = last ? (best.t - last.t) / 60000 : Infinity;

  if (moved < 0.3 && mins < 45){
    console.log(`same spot (${moved.toFixed(2)} nm, ${mins.toFixed(0)} min), not appending`);
  } else if (last && moved > 900 && mins < 60){
    console.log(`implausible jump of ${moved.toFixed(0)} nm, dropping`);
  } else {
    points.push(best);
    fs.appendFileSync(LOG, JSON.stringify(best) + "\n");   // the permanent record
    console.log(`appended fix ${points.length}`);
  }

  const kept = points;

  fs.writeFileSync(TRACK, JSON.stringify({
    mmsi: MMSI,
    updatedAt: Date.now(),
    count: kept.length,
    lastT: kept.length ? kept[kept.length - 1].t : 0,
    meta,
    points: kept
  }, null, 1));

  fs.writeFileSync(POSITION, JSON.stringify({
    mmsi: MMSI,
    incremental: false,           // a static host cannot answer ?since=
    connected: true,
    checkedAt: Date.now(),
    count: kept.length,
    lastT: kept.length ? kept[kept.length - 1].t : 0,
    latest: kept[kept.length - 1] || null,
    meta
  }, null, 1));

  console.log(`wrote docs/position.json and docs/track.json (${kept.length} fixes)`);
  process.exit(0);
}
