const fs = require("fs");
const path = require("path");
const { load } = require("./harness");

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail){
  if (cond){ pass++; }
  else { fail++; failures.push(name + (detail ? "  -> " + detail : "")); }
}
function group(n){ console.log("\n" + n); }

const BUILDS = {
  standalone: "/mnt/user-data/outputs/world-odyssey-tracker-v4.html",
  server:     "/home/claude/odyssey/public/index.html",
  pages:      "/home/claude/wo-pages/docs/index.html"
};

// ---------------------------------------------------------------- structure
group("1. File structure");
for (const [name, f] of Object.entries(BUILDS)){
  const h = fs.readFileSync(f, "utf8");
  ok(`${name}: exists and non-trivial`, h.length > 50000, h.length + " bytes");
  ok(`${name}: no unresolved placeholders`, !/__[A-Z]+__/.test(h));
  ok(`${name}: no leftover CDN references`, !/unpkg|cartocdn|cdnjs/.test(h));
  ok(`${name}: no iframes`, !/<iframe/.test(h));
  ok(`${name}: Apache licence stated`, /Apache License 2\.0/.test(h));
  ok(`${name}: instagram byline links out`, /instagram\.com\/l\.i\.cortes/.test(h));
  ok(`${name}: legend present`, /class="legend"/.test(h));
  ok(`${name}: disclaimer present`, /class="disclaimer"/.test(h));
  ok(`${name}: no affiliation line`, /not affiliated with/i.test(h));
  ok(`${name}: repo link present`, /github\.com\/licortes2026\/ship-tracker/.test(h));
  ok(`${name}: personal note present`, /free time to follow my kid/.test(h));
  ok(`${name}: outbound links open safely`,
     (h.match(/target="_blank"/g)||[]).length === (h.match(/rel="noopener"/g)||[]).length);
}
{
  const h = fs.readFileSync(BUILDS.standalone, "utf8");
  ok("standalone: image is embedded", /href="data:image\/webp;base64,/.test(h));
  ok("standalone: makes no network requests at all",
     !/fetch\("track|fetch\("position/.test(h));
  for (const n of ["server","pages"]){
    const p = fs.readFileSync(BUILDS[n], "utf8");
    ok(`${n}: image is a separate cacheable file`, /href="earth\.webp"/.test(p));
    ok(`${n}: image file shipped`,
       fs.existsSync(path.join(path.dirname(BUILDS[n]), "earth.webp")));
  }
}

// ---------------------------------------------------------------- core maths
group("2. Route geometry");
const A = load(BUILDS.standalone);
const T = A.T;
ok("11 ports", T.PORTS.length === 11);
ok("10 legs", T.LEGS.length === 10);
ok("total distance is plausible", T.TOTAL_NM > 15000 && T.TOTAL_NM < 22000, Math.round(T.TOTAL_NM) + " nm");
ok("route offsets sum to total",
   Math.abs((T.ROUTE_OFF[9] + T.LEGS[9].nm) - T.ROUTE_TOTAL) < 0.01);

// every leg starts and ends exactly on its ports
let legEndsOk = true, worst = 0;
for (let i = 0; i < T.LEGS.length; i++){
  const L = T.LEGS[i];
  const a = T.gcDist(L.line[0], [T.PORTS[i].lat, T.PORTS[i].lon]);
  const b = T.gcDist(L.line[L.line.length-1], [T.PORTS[i+1].lat, T.PORTS[i+1].lon]);
  worst = Math.max(worst, a, b);
  if (a > 0.5 || b > 0.5) legEndsOk = false;
}
ok("legs terminate on their ports", legEndsOk, "worst " + worst.toFixed(3) + " nm");

// cumulative distance monotonic
let mono = true;
T.LEGS.forEach(L => { for (let k = 1; k < L.cum.length; k++) if (L.cum[k] < L.cum[k-1]) mono = false; });
ok("cumulative distances increase monotonically", mono);

// the corrected Iberia leg
const leg1 = T.LEGS[1];
const passesWest = leg1.line.some(p => p[0] < 37.2 && p[0] > 36.6 && p[1] < -8.9);
ok("Leixoes-Tangier rounds Cape St Vincent to the west", passesWest);
const crossesIberia = leg1.line.some(p => p[1] > -8.5 && p[0] > 37.2 && p[0] < 41.0);
ok("Leixoes-Tangier stays off the Iberian landmass", !crossesIberia);
ok("Leixoes-Tangier length is plausible", leg1.nm > 380 && leg1.nm < 520, Math.round(leg1.nm) + " nm");

// no leg crosses the antimeridian
ok("no leg jumps the antimeridian",
   T.LEGS.every(L => L.line.every((p,i) => i === 0 || Math.abs(p[1] - L.line[i-1][1]) < 90)));

group("3. Projection round trip");
let maxErr = 0;
[[41.0,-9.0],[35.9,-6.0],[-12.9,-38.4],[-33.9,18.4],[6.9,79.8],[22.3,114.1]].forEach(q => {
  const s = T.projectRoute(q[0], q[1]).s;
  const back = T.routePoint(s);
  maxErr = Math.max(maxErr, T.gcDist(q, back));
});
ok("projecting then unprojecting lands nearby", maxErr < 60, maxErr.toFixed(1) + " nm");
ok("routePoint clamps below zero", !!T.routePoint(-500));
ok("routePoint clamps past the end", !!T.routePoint(T.ROUTE_TOTAL + 5000));

// ---------------------------------------------------------------- schedule
group("4. Schedule state machine");
function at(iso){ return T.dr(new Date(iso)); }
ok("before embarkation", at("2026-09-01T00:00:00Z").mode === "port" && at("2026-09-01T00:00:00Z").sailed === 0);
ok("at sea to Leixoes", at("2026-09-12T00:00:00Z").mode === "sea");
ok("alongside in Leixoes", at("2026-09-16T12:00:00Z").mode === "port");
ok("St Helena day call registers as in port", at("2026-10-20T12:00:00Z").mode === "port");
ok("at sea to Cape Town", at("2026-10-23T00:00:00Z").mode === "sea");
ok("after disembarkation", at("2027-01-01T00:00:00Z").mode === "end");
ok("sailed distance never exceeds the total", at("2027-01-01T00:00:00Z").sailed <= T.TOTAL_NM + 0.01);

let prev = -1, monotonic = true, sampled = 0;
for (let d = new Date("2026-09-09T00:00:00Z"); d < new Date("2026-12-23T00:00:00Z"); d = new Date(+d + 6*3600000)){
  const s = T.dr(d);
  if (s.sailed < prev - 0.01) monotonic = false;
  prev = s.sailed; sampled++;
}
ok("sailed distance never goes backwards across the whole voyage", monotonic, sampled + " samples");

let fracOk = true;
for (let d = new Date("2026-09-09T00:00:00Z"); d < new Date("2026-12-23T00:00:00Z"); d = new Date(+d + 7*3600000)){
  const s = T.dr(d);
  if (s.f < -0.001 || s.f > 1.001) fracOk = false;
  if (!(s.legIndex >= 0 && s.legIndex < T.LEGS.length)) fracOk = false;
}
ok("leg index and fraction stay in range all voyage", fracOk);

group("5. Speeds implied by the timetable");
let speedOk = true, speeds = [];
for (let i = 0; i < T.LEGS.length; i++){
  const hrs = (new Date(T.PORTS[i+1].arr) - new Date(T.PORTS[i].dep)) / 3600000;
  const v = T.LEGS[i].nm / hrs;
  speeds.push(v.toFixed(1));
  if (v > 24) speedOk = false;
}
ok("no leg demands an impossible speed", speedOk, speeds.join(", ") + " kt");

// ---------------------------------------------------------------- estimates
group("6. Estimated positions");
const now = Date.now();
{
  const B = load(BUILDS.server);
  B.T.setAis([]);
  B.T.draw();
  ok("no fixes: nothing drawn as reported", (B.els.real.attrs.d || "") === "");
  ok("no fixes: nothing drawn as estimated", (B.els.est.attrs.d || "") === "");
  ok("no fixes: marker labelled estimated", B.T.getShipInfo().est === true);
}
{
  const B = load(BUILDS.server);
  // hourly fixes should read as a solid reported line, no dotted infill
  const hourly = [];
  for (let i = 6; i >= 0; i--) hourly.push({ t: now - i*3600000, lat: 45 - i*0.1, lon: -9 - i*0.05, sog: 13, cog: 200 });
  B.T.setAis(hourly);
  B.T.draw();
  const solid = ((B.els.real.attrs.d || "").match(/M/g) || []).length;
  const dotted = ((B.els.est.attrs.d || "").match(/M/g) || []).length;
  ok("hourly fixes draw solid", solid === 6, "solid " + solid);
  ok("hourly fixes draw no estimates", dotted === 0, "dotted " + dotted);
  ok("marker is an AIS fix", B.T.getShipInfo().source === "AIS");
}
{
  const B = load(BUILDS.server);
  B.T.setAis([{ t: now - 50*3600000, lat: 40.0, lon: -10.0, sog: 12, cog: 190 }]);
  B.T.draw();
  const dotted = ((B.els.est.attrs.d || "").match(/M/g) || []).length;
  ok("a 50 hour gap fills with estimates", dotted > 20, "dotted " + dotted);
  ok("stale fix flips the marker to estimated", B.T.getShipInfo().est === true);
  ok("age is measured from the real fix, not the estimate",
     Math.abs(B.T.getShipInfo().realT - (now - 50*3600000)) < 1000);
  const dots = (B.els.fixdots._c() || []).length;
  ok("estimates get no dots, only the real fix does", dots === 1, dots + " dots");
}
{
  const B = load(BUILDS.server);
  B.T.setAis([{ t: now - 30*3600000, lat: 40, lon: -10, sog: 0, cog: 0 }]);
  B.T.draw();
  ok("zero reported speed falls back to the timetable", B.T.getShipInfo().est === true);
}
{
  const B = load(BUILDS.server);
  B.T.setAis([{ t: now - 400*24*3600000, lat: 52, lon: 4, sog: 12, cog: 180 }]);
  B.T.draw();
  const d = B.els.est.attrs.d || "";
  ok("an absurdly old fix does not explode the estimate count",
     (d.match(/M/g) || []).length <= 501);
}

// ---------------------------------------------------------------- ui
group("7. Ports, ship overlay, basemap");
{
  const B = load(BUILDS.standalone);
  B.T.draw();
  for (let i = 0; i < 11; i++){
    B.T.showPort(i);
    const html = B.els.popover.innerHTML;
    ok(`port ${i} card names the port`, html.includes(B.T.PORTS[i].n.split(",")[0]));
    ok(`port ${i} card has a date`, /\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.test(html));
  }
  B.T.showPort(5);
  const reds = B.els.portdots._c().filter(c => c.attrs.fill === "#E8202A");
  ok("exactly one port highlights red", reds.length === 1);
  B.T.showPort(2);
  const reds2 = B.els.portdots._c().filter(c => c.attrs.fill === "#E8202A");
  ok("the highlight moves rather than accumulating", reds2.length === 1 && reds2[0].attrs["data-port"] === "2");
  B.T.clearPort();
  ok("tapping water clears every highlight",
     B.els.portdots._c().filter(c => c.attrs.fill === "#E8202A").length === 0);

  B.T.showShip();
  const sh = B.els.popover.innerHTML;
  ok("ship card names the ship", sh.includes("World Odyssey"));
  ok("ship card shows a position", /\d+°\d+\.\d'/.test(sh));
  ok("ship card shows next port or berth status", /in \d|Alongside/.test(sh));

  ok("embark card is a single line", B.T.PORTS[0].arr === B.T.PORTS[0].dep);
  ok("St Helena is a same-day call",
     new Date(B.T.PORTS[4].dep) - new Date(B.T.PORTS[4].arr) === 10*3600000);
}
{
  const B = load(BUILDS.standalone);
  ok("satellite is the default view", B.els.map.attrs.class === "basemap-sat");
  ok("the button offers the chart", B.els.basemap.textContent === "Chart");
  B.T.setBasemap("chart");
  ok("toggling reaches chart mode", B.els.map.attrs.class === "basemap-chart");
  ok("the choice is remembered", B.store.wo_basemap === "chart");
}
{
  const B = load(BUILDS.standalone, { noStorage:true });
  ok("a browser with storage blocked still loads", !!B.T.PORTS);
  B.T.setBasemap("chart");
  ok("and still toggles", B.els.map.attrs.class === "basemap-chart");
}

group("8. Manual fix logging is gone");
{
  for (const [name, f] of Object.entries(BUILDS)){
    const h = fs.readFileSync(f, "utf8");
    ok(`${name}: no fix input field`, !/id="latlon"/.test(h));
    ok(`${name}: no add button`, !/id="addfix"/.test(h));
    ok(`${name}: no local fix storage`, !/wo_fixes/.test(h));
    ok(`${name}: no coordinate parser`, !/parseLatLon/.test(h));
    ok(`${name}: nothing labelled hand-logged`, !/logged by hand|Logged by hand/.test(h));
    ok(`${name}: status line survives`, /id="fixcount"/.test(h));
  }
  ok("formats south and west correctly", /S/.test(A.T.fmtPos([-12.5,-38.2])) && /W/.test(A.T.fmtPos([-12.5,-38.2])));
  ok("formats north and east correctly", /N/.test(A.T.fmtPos([52.4,4.5])) && /E/.test(A.T.fmtPos([52.4,4.5])));
}

group("9. Zoom and pan limits");
{
  const B = load(BUILDS.standalone);
  for (let i = 0; i < 40; i++) B.T.zoomBy(0.5, 190, 170);
  ok("zooming in stops at a floor", B.T.view.span >= 1.1, "span " + B.T.view.span.toFixed(2));
  for (let i = 0; i < 40; i++) B.T.zoomBy(2, 190, 170);
  ok("zooming out stops at the whole world", B.T.view.span <= 360.01, "span " + B.T.view.span.toFixed(2));
  B.T.view.cy = -9999; B.T.applyView();
  ok("panning cannot fly off the top", B.T.view.cy > -200);
  B.T.view.cy = 9999; B.T.applyView();
  ok("panning cannot fly off the bottom", B.T.view.cy < 200);
  const vb = (B.els.map.attrs.viewBox || "").split(" ").map(Number);
  ok("viewBox always has four finite numbers", vb.length === 4 && vb.every(Number.isFinite));
}

console.log("\n" + "=".repeat(52));
console.log(`  ${pass} passed, ${fail} failed`);
if (failures.length){ console.log("\n  Failures:"); failures.forEach(f => console.log("   - " + f)); }
console.log("=".repeat(52));
process.exit(fail ? 1 : 0);
