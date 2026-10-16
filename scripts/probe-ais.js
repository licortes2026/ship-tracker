#!/usr/bin/env node
/*
 * Copyright 2026 Luis I. Cortes
 * Licensed under the Apache License, Version 2.0.
 *
 * One-off diagnostic, run by hand from the Actions tab (probe.yml). It subscribes to
 * aisstream with NO ship filter over a few named boxes and reports who it hears in
 * each. Two questions: does aisstream hear anything at all near a port she called at,
 * and is the key itself working (a busy control box answers that). It writes nothing
 * into docs/ and never touches the tracker's data.
 *
 * PROBE_BOXES  "name:lat1,lon1,lat2,lon2;name:..."  (corners, any order)
 * PROBE_SECONDS  listening time, default 180
 */
"use strict";
const WebSocket = require("ws");

const KEY = process.env.AISSTREAM_API_KEY;
const MMSI = String(process.env.ODYSSEY_MMSI || "311000410");
const SECONDS = parseInt(process.env.PROBE_SECONDS || "180", 10);
const SPEC = process.env.PROBE_BOXES ||
  "salvador:-14.0,-39.5,-12.0,-37.5;control-english-channel:49.5,-2.0,51.5,2.0";

if (!KEY){ console.error("No AISSTREAM_API_KEY."); process.exit(1); }

const boxes = SPEC.split(";").filter(Boolean).map(x => {
  const [name, c] = x.split(":");
  const [a, b, c2, d] = c.split(",").map(Number);
  return { name, lat: [Math.min(a, c2), Math.max(a, c2)], lon: [Math.min(b, d), Math.max(b, d)],
           ships: new Map(), msgs: 0 };
});

const unexpected = [];
let total = 0, opened = false, herFixes = [];
const ws = new WebSocket("wss://stream.aisstream.io/v0/stream", { perMessageDeflate: true });
const timer = setTimeout(report, SECONDS * 1000);

ws.on("open", () => {
  opened = true;
  console.log(`listening ${SECONDS}s over ${boxes.length} box(es): ${boxes.map(b => b.name).join(", ")}`);
  ws.send(JSON.stringify({
    APIKey: KEY,
    BoundingBoxes: boxes.map(b => [[b.lat[0], b.lon[0]], [b.lat[1], b.lon[1]]]),
    FilterMessageTypes: ["PositionReport", "ShipStaticData"]
  }));
});

ws.on("message", raw => {
  let m; try { m = JSON.parse(raw.toString()); } catch (e) { unexpected.push(String(raw).slice(0, 200)); return; }
  const meta = m.MetaData || {};
  if (m.error || m.Error || !m.MessageType){ unexpected.push(JSON.stringify(m).slice(0, 300)); return; }
  total++;
  const lat = meta.latitude, lon = meta.longitude, id = String(meta.MMSI || "");
  for (const b of boxes){
    if (typeof lat === "number" && lat >= b.lat[0] && lat <= b.lat[1] && lon >= b.lon[0] && lon <= b.lon[1]){
      b.msgs++;
      if (!b.ships.has(id)) b.ships.set(id, (meta.ShipName || "").trim());
    }
  }
  if (id === MMSI) herFixes.push({ t: meta.time_utc, lat, lon });
});

ws.on("error", e => { console.error("stream error:", e.message); report(); });

let done = false;
function report(){
  if (done) return; done = true;
  clearTimeout(timer); try { ws.close(); } catch (e) {}
  console.log(`\nwebsocket opened: ${opened}`);
  console.log(`messages received: ${total}`);
  for (const b of boxes){
    console.log(`\nbox ${b.name}: ${b.msgs} message(s) from ${b.ships.size} ship(s)`);
    [...b.ships].slice(0, 15).forEach(([id, n]) => console.log(`   ${id}  ${n}`));
  }
  console.log(`\nWorld Odyssey (${MMSI}) heard: ${herFixes.length ? JSON.stringify(herFixes.slice(-3)) : "no"}`);
  if (unexpected.length){
    console.log(`\n${unexpected.length} unexpected message(s), first few:`);
    unexpected.slice(0, 5).forEach(u => console.log("   " + u));
  }
  console.log("\nHow to read this: control box empty and unexpected messages present = key or"
    + " subscription problem. Control box busy and the port box empty = no receiver feeding"
    + " aisstream there; the feed cannot see her and a second source is needed.");
  process.exit(0);
}
