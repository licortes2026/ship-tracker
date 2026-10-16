/*
 * Copyright 2026 Luis I. Cortes
 * Licensed under the Apache License, Version 2.0.
 *
 * A second position source for when aisstream cannot hear her. It does not know any one
 * provider: it calls a JSON HTTP endpoint you describe in repository secrets and
 * variables, and reads the fields you name. Most AIS lookup APIs fit.
 *
 *   AIS_HTTP_URL      endpoint, with {mmsi} and {key} placeholders
 *   AIS_HTTP_KEY      the provider's key (a secret)
 *   AIS_HTTP_HEADERS  optional JSON object of request headers; {key} is substituted
 *   AIS_HTTP_MAP      JSON object naming where each field sits in the response, as a dotted
 *                     path: {"lat":"data.latitude","lon":"data.longitude","sog":"data.speed",
 *                     "cog":"data.course","t":"data.last_position_utc"}
 *
 * Times may be epoch seconds, epoch milliseconds or an ISO string. Returns null, never
 * throws, when there is nothing usable, so a provider outage cannot break the run.
 */
"use strict";

function dig(obj, p){
  return String(p).split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function toMs(v){
  if (v == null || v === "") return NaN;
  if (typeof v === "number") return v < 1e11 ? v * 1000 : v;
  if (/^\d+(\.\d+)?$/.test(String(v))) return toMs(Number(v));
  // "2026-10-07 11:03:00 UTC" and similar: treat a bare date-time as UTC.
  let s = String(v).trim().replace(" UTC", "Z").replace(" ", "T");
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += "Z";
  return Date.parse(s);
}

async function fetchPosition({ mmsi, env, fetchImpl }){
  const url = env.AIS_HTTP_URL, key = env.AIS_HTTP_KEY || "";
  if (!url) return null;
  let map, headers = {};
  try { map = JSON.parse(env.AIS_HTTP_MAP || "{}"); } catch (e) { console.log("generic-http: AIS_HTTP_MAP is not JSON"); return null; }
  if (!map.lat || !map.lon){ console.log("generic-http: AIS_HTTP_MAP needs lat and lon paths"); return null; }
  try {
    if (env.AIS_HTTP_HEADERS) headers = JSON.parse(env.AIS_HTTP_HEADERS);
  } catch (e) { console.log("generic-http: AIS_HTTP_HEADERS is not JSON"); return null; }
  for (const k of Object.keys(headers)) headers[k] = String(headers[k]).replace(/\{key\}/g, key);

  const target = url.replace(/\{mmsi\}/g, encodeURIComponent(mmsi)).replace(/\{key\}/g, encodeURIComponent(key));
  const f = fetchImpl || fetch;
  let body;
  try {
    const res = await f(target, { headers });
    if (!res.ok){ console.log(`generic-http: HTTP ${res.status}`); return null; }
    body = await res.json();
  } catch (e) { console.log("generic-http: request failed: " + e.message); return null; }

  const lat = Number(dig(body, map.lat)), lon = Number(dig(body, map.lon));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const t = map.t ? toMs(dig(body, map.t)) : NaN;
  if (!Number.isFinite(t)){ console.log("generic-http: no usable timestamp, not trusting the position"); return null; }
  const sog = map.sog ? Number(dig(body, map.sog)) : undefined;
  const cog = map.cog ? Number(dig(body, map.cog)) : undefined;
  return { t, lat, lon, sog: Number.isFinite(sog) ? sog : null, cog: Number.isFinite(cog) ? cog : null };
}

module.exports = { fetchPosition, toMs };
