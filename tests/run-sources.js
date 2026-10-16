// The optional second position source, against a local fake provider.
const http = require("http");
const path = require("path");
const { fetchPosition, toMs } = require(path.join(__dirname, "..", "scripts", "sources", "generic-http.js"));

let pass = 0, fail = 0; const failures = [];
function ok(n, c, d){ if (c) pass++; else { fail++; failures.push(n + (d ? "  -> " + d : "")); } }

(async () => {
  console.log("\n14. Second position source");
  ok("epoch seconds", toMs(1790700000) === 1790700000000);
  ok("epoch milliseconds", toMs(1790700000000) === 1790700000000);
  ok("iso with Z", toMs("2026-10-07T11:03:00Z") === Date.UTC(2026, 9, 7, 11, 3, 0));
  ok("bare datetime is UTC", toMs("2026-10-07 11:03:00") === Date.UTC(2026, 9, 7, 11, 3, 0));
  ok("trailing UTC word", toMs("2026-10-07 11:03:00 UTC") === Date.UTC(2026, 9, 7, 11, 3, 0));
  ok("garbage is NaN", Number.isNaN(toMs("soon")));

  let seen = null, mode = "good";
  const srv = http.createServer((req, res) => {
    seen = { url: req.url, auth: req.headers["x-api-key"] };
    if (mode === "500"){ res.statusCode = 500; return res.end("no"); }
    res.setHeader("content-type", "application/json");
    if (mode === "notime") return res.end(JSON.stringify({ data: { latitude: -12.97, longitude: -38.51 } }));
    if (mode === "badlat") return res.end(JSON.stringify({ data: { latitude: 400, longitude: 1, ts: 1790700000 } }));
    res.end(JSON.stringify({ data: { latitude: "-12.9711", longitude: "-38.5124", speed: "0.1", course: 12, ts: 1790700000 } }));
  });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  const env = {
    AIS_HTTP_URL: `http://127.0.0.1:${port}/v1/vessel?mmsi={mmsi}&k={key}`,
    AIS_HTTP_KEY: "SECRET", AIS_HTTP_HEADERS: JSON.stringify({ "x-api-key": "{key}" }),
    AIS_HTTP_MAP: JSON.stringify({ lat: "data.latitude", lon: "data.longitude", sog: "data.speed", cog: "data.course", t: "data.ts" })
  };
  const quiet = console.log; console.log = () => {};
  try {
    let r = await fetchPosition({ mmsi: "311000410", env });
    console.log = quiet;
    ok("reads position and time", r && Math.abs(r.lat + 12.9711) < 1e-9 && r.t === 1790700000000, JSON.stringify(r));
    ok("substitutes mmsi, key and header", seen && seen.url.includes("mmsi=311000410") && seen.url.includes("k=SECRET") && seen.auth === "SECRET");
    ok("speed and course carried", r && r.sog === 0.1 && r.cog === 12);
    console.log = () => {};
    mode = "500"; r = await fetchPosition({ mmsi: "1", env });
    const a = r; mode = "notime"; r = await fetchPosition({ mmsi: "1", env });
    const b = r; mode = "badlat"; r = await fetchPosition({ mmsi: "1", env });
    const c = r;
    const d = await fetchPosition({ mmsi: "1", env: {} });
    console.log = quiet;
    ok("HTTP error gives null, not a throw", a === null);
    ok("no timestamp is not trusted", b === null);
    ok("impossible latitude is rejected", c === null);
    ok("unconfigured gives null", d === null);
  } finally { console.log = quiet; srv.close(); }

  console.log("\n====================================================");
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log("====================================================");
  if (fail){ failures.forEach(f => console.log("  FAIL  " + f)); process.exit(1); }
})();
