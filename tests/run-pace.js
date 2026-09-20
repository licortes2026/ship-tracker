// The live estimate is paced to the schedule, and the route ahead lands on the next port.
//
// Both use the case that prompted them, with the clock fixed so the result never depends on
// the day the suite runs. Last fix: 19 Sep 17:15 UTC, 37.90 N 9.87 W, 9.8 kt, about 264 nm
// from Tangier. Due there 22 Sep 08:00 local, 61.7 hours later, which is a pace of 4.3 kt.
// At 9.8 kt she would be 35 nm from Tangier on 20 Sep and nothing says she is early.
const { load } = require("./harness");
const { AIS_BUILD } = require("./paths");

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail){
  if (cond){ pass++; } else { fail++; failures.push(name + (detail ? "  -> " + detail : "")); }
}
function group(n){ console.log("\n" + n); }

const RealDate = Date;
// Run fn with the page's idea of "now" fixed. The page reads both Date.now() and new Date().
function at(ms, fn){
  class FakeDate extends RealDate {
    constructor(...a){ if (a.length === 0) super(ms); else super(...a); }
    static now(){ return ms; }
  }
  global.Date = FakeDate;
  try { return fn(); } finally { global.Date = RealDate; }
}

const TANGIER = [35.785, -5.813];
const SALVADOR = [-12.968, -38.513];
const WP2 = [36.652010, -9.527220];                    // last waypoint before Tangier
const DUE = RealDate.parse("2026-09-22T08:00:00+01:00");
const NOW = RealDate.parse("2026-09-20T16:35:00Z");    // 23.3 h after the fix, still at sea
const AFTER = DUE + 6*3600000;                         // alongside by the timetable
const FIX = { t: 1789838139054, lat: 37.900843, lon: -9.866143, sog: 9.8, cog: 159.2 };

function estimate(now, fix, opts){
  return at(now, () => {
    const B = load(AIS_BUILD);
    if (opts && opts.due) B.T.PORTS[2].arr = opts.due;
    B.T.setAis([fix]);
    B.T.draw();
    const trk = B.T.buildTrack().filter(p => p.est);
    const tip = trk[trk.length - 1];
    return { B, trk, tip, len: trk.length > 1 ? B.T.pathLen(trk.map(p => [p.lat, p.lon])) : 0 };
  });
}
const ll = p => [p.lat, p.lon];
const nearest = (path, pt, gc) => {
  let best = { i: -1, d: Infinity };
  path.forEach((p, i) => { const d = gc(p, pt); if (d < best.d) best = { i, d }; });
  return best;
};

// ------------------------------------------------------------------ estimate
group("A. The estimate is paced to the schedule");
{
  const r = estimate(NOW, FIX);
  const gc = r.B.T.gcDist;
  ok("there is an estimate", r.trk.length > 5, r.trk.length + " points");

  // Total run fix to Tangier, taken from the estimate itself once it has had time to arrive.
  const done = estimate(AFTER, FIX);
  const whole = done.len;
  ok("given time, the estimate arrives on Tangier itself",
     gc(ll(done.tip), TANGIER) < 1.5, gc(ll(done.tip), TANGIER).toFixed(2) + " nm short");

  const sched = whole * (r.tip.t - FIX.t) / (DUE - FIX.t);      // where the timetable has her
  ok("she is never shown ahead of the timetable",
     r.len <= sched + 3, r.len.toFixed(1) + " nm run against " + sched.toFixed(1) + " nm allowed");
  ok("and she is not held back below the pace either",
     r.len >= sched - 6, r.len.toFixed(1) + " nm run against " + sched.toFixed(1) + " nm allowed");

  const fast = estimate(NOW, FIX, { due: "2026-09-19T00:00:00Z" });    // due before the fix: nothing to pace against
  ok("without the schedule she would be close to Tangier already",
     gc(ll(fast.tip), TANGIER) < 60, gc(ll(fast.tip), TANGIER).toFixed(0) + " nm");
  ok("with it she is far farther out, which is the point",
     gc(ll(r.tip), TANGIER) > gc(ll(fast.tip), TANGIER) + 80,
     gc(ll(r.tip), TANGIER).toFixed(0) + " nm against " + gc(ll(fast.tip), TANGIER).toFixed(0) + " nm");

  const info = r.B.T.getShipInfo();
  ok("the marker is still labelled estimated", info.est === true && info.source === "estimated");
  ok("the assumed speed is the schedule pace, not her last reported speed",
     info.sog > 3.8 && info.sog < 4.8, info.sog + " kt");
  ok("the ship card can say it is held to the schedule", info.paced === true);
}
{
  // Slower than the pace needed: her own speed rules, nothing is stretched or sped up.
  const slow = { ...FIX, sog: 3.0 };
  const r = estimate(NOW, slow);
  const hours = Math.floor((NOW - slow.t) / 3600000);
  ok("a ship slower than the pace is run at her own speed",
     Math.abs(r.len - 3.0 * hours) < 0.1 * 3.0 * hours, r.len.toFixed(1) + " nm in " + hours + " h");
  ok("and that is not called schedule pacing", r.B.T.getShipInfo().paced === false);
}
{
  // A fix taken after the scheduled arrival leaves nothing to pace against.
  const late = { t: DUE + 3600000, lat: 35.90, lon: -6.35, sog: 8.0, cog: 110 };
  const r = estimate(DUE + 5*3600000, late);
  ok("a fix later than the due time is not paced",
     r.trk.length > 1 && r.B.T.getShipInfo().paced === false, "paced " + r.B.T.getShipInfo().paced);
  ok("it runs at her reported speed", r.tip && Math.abs(r.tip.sog - 8.0) < 0.01, r.tip && r.tip.sog);
}

// --------------------------------------------------------------- route ahead
group("B. The route ahead lands on the next port, then carries on");
{
  const B = at(NOW, () => load(AIS_BUILD));
  const gc = B.T.gcDist;
  const pos = [35.9207, -6.3567];                      // the estimate as it stood, west of Tangier
  const path = at(NOW, () => B.T.forwardPath(pos));

  ok("it starts exactly where she is", gc(path[0], pos) < 0.01, gc(path[0], pos).toFixed(4) + " nm");
  const tan = nearest(path, TANGIER, gc), sal = nearest(path, SALVADOR, gc);
  ok("it reaches Tangier", tan.d < 1.0, tan.d.toFixed(2) + " nm");
  ok("it then reaches Salvador", sal.d < 1.0, sal.d.toFixed(2) + " nm");
  ok("Tangier comes before Salvador", tan.i < sal.i, tan.i + " then " + sal.i);
  ok("it does not head for Brazil from where she is",
     gc(path[1], TANGIER) < gc(pos, TANGIER) + 5,
     "first step " + gc(path[1], TANGIER).toFixed(1) + " nm from Tangier, she is " + gc(pos, TANGIER).toFixed(1));

  // every remaining port, in order, and the voyage ends at Bangkok
  let prev = -1, allIn = true, inOrder = true;
  for (let k = 2; k < B.T.PORTS.length; k++){
    const p = B.T.PORTS[k], n = nearest(path, [p.lat, p.lon], gc);
    if (n.d > 1.0) allIn = false;
    if (n.i <= prev) inOrder = false;
    prev = n.i;
  }
  ok("it passes through every remaining port", allIn);
  ok("in itinerary order", inOrder);
  const end = B.T.PORTS[B.T.PORTS.length - 1];
  ok("and ends at the last port", gc(path[path.length - 1], [end.lat, end.lon]) < 0.5);

  ok("naming the leg gives the same line as leaving it to the timetable",
     JSON.stringify(at(NOW, () => B.T.forwardPath(pos, 1))) === JSON.stringify(path));
}
{
  // Mid-leg, on the fix, the line must pass the last waypoint and then Tangier.
  const B = at(NOW, () => load(AIS_BUILD));
  const gc = B.T.gcDist;
  const path = at(NOW, () => B.T.forwardPath([FIX.lat, FIX.lon]));
  const w = nearest(path, WP2, gc), t = nearest(path, TANGIER, gc);
  ok("from her last fix it passes the final waypoint", w.d < 0.5, w.d.toFixed(2) + " nm");
  ok("and then Tangier", t.d < 0.5 && t.i > w.i, t.d.toFixed(2) + " nm, after waypoint: " + (t.i > w.i));
}
{
  // Off the planned line and close to the port, the correction must be gone by the port.
  const B = at(NOW, () => load(AIS_BUILD));
  const gc = B.T.gcDist, T = B.T;
  const p = T.routePoint(T.ROUTE_OFF[1] + T.LEGS[1].nm - 40);
  const off = [p[0] + 0.25, p[1]];                     // about 15 nm off the line, 40 nm out
  const path = at(NOW, () => T.forwardPath(off));
  const n = nearest(path, TANGIER, gc);
  ok("15 nm off the line, 40 nm out, it still lands on the port", n.d < 0.5, n.d.toFixed(2) + " nm");
}
{
  // The leg is measured to the line, not to its corners.
  const B = at(NOW, () => load(AIS_BUILD));
  const T = B.T;
  ok("projectLeg is available", typeof T.projectLeg === "function");
  if (typeof T.projectLeg === "function"){
    const f = 0.37, pt = T.pointAt(T.LEGS[1], f);
    const r = T.projectLeg(pt[0], pt[1], 1);
    const want = T.ROUTE_OFF[1] + f * T.LEGS[1].nm;
    ok("a point on the line projects to where it is, between the corners",
       Math.abs(r.s - want) < 0.5 && r.off < 0.5, (r.s - want).toFixed(2) + " nm off, " + r.off.toFixed(2) + " from the line");
  }
}

{
  // The ship card's "nm to run" must agree with the marker beside it. It was measured with
  // the whole-route vertex snap, about 30 nm out here.
  const r = estimate(NOW, FIX);
  const T = r.B.T;
  at(NOW, () => T.showShip());
  const html = r.B.els.popover.innerHTML || "";
  const m = html.match(/([\d,]+) nm to run/);
  const togo = m ? Number(m[1].replace(/,/g, "")) : NaN;
  const away = T.gcDist(T.getShipPos(), TANGIER);
  ok("the ship card gives a distance to run", !!m, html.slice(0, 120));
  ok("and it agrees with where the marker is drawn",
     Math.abs(togo - away) < 8, togo + " nm on the card, " + away.toFixed(0) + " nm from the marker to Tangier");
}

console.log("\n====================================================");
console.log(`  ${pass} passed, ${fail} failed`);
console.log("====================================================");
if (fail){ for (const f of failures) console.log("  FAIL  " + f); process.exit(1); }
