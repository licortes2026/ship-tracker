# HANDOFF: MV World Odyssey tracker

Written 2026-09-14, last revised 2026-09-15 (v1.3). Everything below is current as of that date.

This project was built across one long chat session. This document carries the context
that would otherwise be lost. Read it before changing anything.

---

## 1. What this is

A public web page that shows where the MV World Odyssey is, for family and shipboard
community following the Fall 2026 Semester at Sea voyage. Personal, non-commercial,
unofficial.

**Vessel:** MV World Odyssey, MMSI `311000410`, IMO `9141807`, call sign C6BZ6, Bahamas flag.

**Voyage:** IJmuiden 9 Sep 2026 to Bangkok 22 Dec 2026, eleven ports.

**Live now:**
* Repo: https://github.com/licortes2026/ship-tracker
* Page: https://licortes2026.github.io/ship-tracker/

---

## 2. Three builds, one page

The same page ships three ways. They differ only in where the earth image lives and
whether AIS data is available.

| Build | Path | Image | AIS source |
|---|---|---|---|
| Standalone | `world-odyssey-tracker-v4.html` | embedded base64 webp | none, dead reckoning only |
| Pages | `wo-pages/docs/index.html` | separate `earth.webp` | `position.json` written hourly by a GitHub Action |
| Server | `odyssey/public/index.html` | separate `earth.webp` | `track.json` and `position.json` from a Node process |

The Pages build is what is deployed. The server build is an alternative that was built
first and still works; it collects far more fixes but needs a machine that stays on.

**When you change the page, change all three.** They are separate files, not includes.
The test battery checks all three.

---

## 3. Repository layout

Two layouts exist and both work. **The published repo** is the Pages build at its root
with the server build as a subdirectory:

```
.github/workflows/track.yml   hourly cron, listens for AIS, commits the result
scripts/fetch-position.js     the fetcher. websocket to aisstream, 8 minute window
docs/index.html               the page
docs/earth.webp               NASA Blue Marble, 2048x1024, 118KB
docs/log.jsonl                APPEND ONLY. the permanent record. never prune this
docs/track.json               rebuilt from log.jsonl every run
docs/position.json            latest fix only, ~270 bytes, what the page polls
tests/                        the test battery, for both builds
HANDOFF.md                    this document
odyssey/                      the server alternative (see below)
```

**This `SaS` directory** keeps `wo-pages/` and `odyssey/` as siblings, which is how the
project was developed. `tests/paths.js` detects which layout it is in, so the battery runs
either way.

### `odyssey/` (the server alternative)

```
server.js          AIS listener plus static server, port 8787
deploy.sh          one-command deploy to a VPS, sets up systemd and Caddy
install.sh         local setup
public/            the page and its image
data/              positions.jsonl, gitignored
```

Added to the repo 2026-09-13. Its `HANDOFF.md` and `tests/` are deliberately **not**
committed: the repo root already has both, and duplicating a 200-line document and a test
battery inside one repo guarantees they drift apart. The root `tests/` covers the server
build, so nothing is lost. The local `odyssey/tests/` copy in this directory is redundant
for the same reason — the root one is canonical.

`odyssey/LICENSE` and `odyssey/NOTICE` *are* committed, even though they duplicate the
root copies, so the directory stays self-contained when `deploy.sh` ships it to a VPS.
Licence text does not drift.

---

## 4. How the data flows

### Collection (GitHub Action, hourly)

1. Cron fires. Checks out, installs `ws`, runs `scripts/fetch-position.js`.
2. Opens a websocket to `wss://stream.aisstream.io/v0/stream`, filtered to the MMSI.
3. Listens eight minutes (`LISTEN_SECONDS`, was 75s) and runs the window out, keeping
   the last report, so the fix is the freshest available rather than the first heard.
4. Guards: rejects a fix under 0.3nm from the last one within 45 minutes (same berth),
   rejects a jump over 900nm within an hour (bad data).
5. Appends one line to `docs/log.jsonl`, rebuilds `track.json` and `position.json` from it.
6. Commits and pushes, retrying up to four times with a rebase if the remote moved.

Key is a repo secret named `AISSTREAM_API_KEY`. Never commit it.

### Display (the page)

1. On load: fetches `track.json` once, draws it.
2. Hourly: fetches `position.json` (270 bytes). If the count changed, appends the new
   position. Also sends a HEAD request for itself and reloads only if the ETag changed.
3. Every ten minutes: recomputes dead reckoning locally. No network.
4. On wake from a backgrounded tab: redraws immediately, since iOS freezes timers.

---

## 5. What the page draws

**`SPEC_track_rendering.md` is the design of record for everything in this section.**
Read it before changing any drawing code.

* **Solid yellow** — history where the trajectory is determined: the straight line
  between two fixes consumed every mile her speed allowed, so she had no room to
  deviate. Time alone does not decide this; time against speed does.
* **Dashed yellow** — history across a silence. Reconstructed shape, real endpoints.
* **Crimson dotted** — the live estimate, newest fix to now. At most one, always at the
  tip, never left behind in history.
* **Grey dashed** — the route still ahead, re-originated from her actual position and
  converging onto the planned waypoints over 60nm.
* **Dots** — one per AIS reading, only ever on reported positions.
* **Marker** — yellow ring on a fresh fix, crimson when the position is estimated.

The rule: **consolidated history is yellow and ends on the newest AIS fix; dashed where
it is reconstruction, solid where it is nearly observation. The only crimson is the live
estimate.** Added v1.3, 2026-09-15.

**The clock-driven schedule line is gone.** It was drawn from the timetable along the
planned route, ignoring AIS completely, and was the brightest mark on the chart with no
legend entry — so it read as her route when it was only the calendar. Whether she is
ahead or behind schedule is text under the map now, not a line on it.

**Solid or dashed is decided by how far she could possibly have strayed**, not by
elapsed time. With the two fixes as foci and her distance budget as the major axis, the
ellipse's semi-minor axis is the furthest she could be from the direct line; under 10nm
it is drawn straight. The 16-hour silence on the Leixões leg covers 133.8nm needing
8.33kt against 8.3 reported, so stray is zero and it is solid. The earlier 90-minute rule
called it a guess and drew a curve. Changed v1.4, 2026-09-15.

**A reconstruction may never be longer than her speed allows.** The warp follows the
planned route and can add distance: on that same gap it drew 143.6nm against a 132.5nm
budget. Reconstructions are blended toward the straight line until they fit, which cannot
move the endpoints since warp and straight line agree there.

**Reconstructed spans are warped, not straight.** Between two fixes the shape comes from
the planned route, corrected by a fade from one fix's offset to the other's, so it starts
and ends exactly on reported positions and follows the coast's form in between. The warp
spans exactly one gap and cannot reach past either endpoint, so it can never drag a
confirmed fix off the place it was reported. A fixed-distance lookback could: 200nm back
from fix 5 on the Leixões leg reaches 166nm and would have moved fixes 4, 3 and 2.

**Offshore clearance is specified but not enforced.** Reconstructions should sit 50-60nm
off the coast. Measured on the 134nm gap they run 5.8 to 45.0nm out — close to target
where her fixes were offshore, too close inshore where a fix was taken near the coast.
Enforcing it needs point-to-coastline distance against the baked-in Natural Earth
polygons on every redraw. See the spec.

Tapping a port opens a card with arrival, on-ship time, days alongside, and status.
Tapping the ship opens speed, course, fix age, next port and miles to run.

Two basemaps: NASA Blue Marble (default) and a drawn chart from embedded Natural Earth
vectors. Toggle is remembered in localStorage.

---

## 6. Decisions made deliberately. Do not undo these without reason.

**No map library, no tiles, no iframes.** Leaflet from unpkg and MarineTraffic embeds
both fail inside the Claude artifact sandbox and behind strict CSP. The coastlines are
baked in as SVG path data and the pan/zoom is hand-written against the viewBox. This is
why the page works offline and on bad ship wifi.

**Estimated positions are visually distinct and never get dots.** Dots appear only where
someone actually reported a position. The user asked at one point to show estimates "as
real"; they are drawn as a continuous line but not labelled as reports, because passing
dead reckoning off as a fix is exactly the failure this page was built to avoid.

**Gaps between fixes are never filled in. AIS is the only source of truth for where she
has been.** Removed 2026-09-14. `buildTrack` used to insert an hourly estimate into any
gap over 90 minutes, positioned with `routePoint()` — a point on the *planned* route. She
sails west of that route, so the track left a fix, jumped east onto the planned line, ran
along it, and jumped back west to the next fix: a sawtooth she never sailed, and the
loudest thing on the chart. Interpolating along the timetable between two known positions
was never an estimate of where she went. The track now runs fix to fix and a gap reads as
a gap. Three tests in section 6 guard it, including one asserting that every drawn vertex
is a reported coordinate, so nothing can wander back onto the planned route.

Forward extrapolation past the newest fix stays: that is the honest answer to "where is
she now" when the last report is hours old, and it is clearly the estimate.

**The estimate begins at her reported position and heads for the next port.** Fixed
2026-09-15, and this was the same `routePoint()` bug surviving in the forward case after
it was removed from the gaps. The estimate was computed as a distance *along the planned
route* (`last._s + v*k`), so its first point sat on that route rather than on her track,
and the chart drew a line sideways from her last fix onto the timetable's line. It now
dead reckons in real coordinates with `gcDest` along the great-circle bearing from her
position to the next port. Measured from a fix 31.6nm off the planned route: the first
estimate point lands 7.7nm ahead of her, one hour at 7.7 knots, and 28.8nm away from the
route point the old code would have used.

Direction is bearing-to-next-port rather than her last reported course. A course is only
true until she alters it; over a five-day silence on a crossing her last heading would
sail her into Africa. The run is clamped at the port, because arithmetic that puts her
past it means she has arrived, and saying so beats drawing her inland.

**A stale fix flags the marker estimated even when no estimate can be drawn.** If her
last reported speed is unusable and the timetable has her alongside, there is no speed to
extrapolate with. The marker then stops advancing, and it used to keep the magenta ring
and the source "AIS", presenting a fix hours old as her current position. Staleness is now
judged on the age of the newest real fix, independently of whether a movement estimate
exists. A date-dependent test caught this the day the timetable put her in Leixões.

**The log is append-only and never pruned.** A full voyage of hourly fixes is about 2,500
lines and 158KB. Earlier code thinned it; that was solving a problem that does not exist.

**Apache 2.0 for everything, code and content alike.** Apache specifically for section 6,
which grants no trademark rights, on a project that has to name ships and universities it
is not affiliated with.

The content was briefly dual-licensed CC BY 4.0, dropped 2026-09-13. Three reasons. The
split could not actually be drawn: this is one HTML file with CSS, SVG path data, copy and
JavaScript interleaved, so no one could say which licence governed the disclaimer
paragraph. It left the trademarks exposed, because the page *text* is where Semester at
Sea, the Institute for Shipboard Education and Colorado State University are named, and CC
BY has no trademark clause — section 6 is the clause that needs to reach those words.
And `LICENSE` and `NOTICE` never mentioned CC BY in the first place; it appeared only in
two prose sentences, so removing it settled a contradiction rather than giving anything up.

Apache 2.0 licenses a "Work", meaning any work of authorship, not only source code, and
requires attribution through section 4, so nothing was lost by consolidating. Note that
CC BY 4.0 is irrevocable: anyone holding a copy published before that date keeps CC BY
rights to that version's content. The change binds future versions only.

**No trademark use in the repo name or branding.** The repo is `ship-tracker`, not
`semester-at-sea-tracker`. The disclaimer names Semester at Sea, the Institute for
Shipboard Education, Colorado State University and the vessel operators as unaffiliated.
Do not add commerce, bookings or a marketplace to this page; that changes the legal
analysis completely.

**No App Store.** Apple guideline 4.2 rejects web wrappers. The install path is Add to
Home Screen from Safari.

---

## 7. Gotchas discovered the hard way

* **Ramer-Douglas-Peucker on a closed ring returns two points.** The first and last point
  are identical, so the baseline has zero length and every perpendicular distance is zero.
  Split the ring in half before simplifying.
* **Antimeridian rings smear across the map.** Unwrap longitudes by adding or subtracting
  360 on jumps over 180, then recentre the ring, then emit a shifted copy if it overruns.
  Afro-Eurasia touches both edges and will vanish if you drop wide rings instead.
* **`textLength` is not universally honoured.** The headline measures itself with
  `getComputedTextLength()` and rescales, then re-cuts the viewBox from `getBBox()`.
* **base64 barely compresses.** The embedded image was 291KB of a 446KB file and gzip only
  got the whole thing to 271KB. Splitting the image out took the served page to 54KB on
  the wire. The 113KB of coastline paths gzip to almost nothing.
* **`location.reload()` can be served from cache.** Needs `Cache-Control: no-cache` plus
  ETag on the server side, and a `fetch(url, {cache:"reload"})` before reloading.
* **A selected element that changes size drops out of a size-based selector.** Cost one
  bug where the previously selected port stayed red. Tag elements, do not measure them.
* **GitHub Actions pushes race with anything else touching main.** Hence the retry loop.
* **A test harness global can be silently ignored by the runtime that owns that name.**
  Deno defines `localStorage` and `navigator` as accessors whose setter discards the
  assignment, so `global.localStorage = stub` left the real one in place and the page
  under test wrote to Deno's actual storage. The failure surfaced as "the choice is
  remembered" failing, which reads like a bug in the page and is not. The harness now
  uses `Object.defineProperty` for every global it fakes.

---

## 8. Tests

```
cd tests && ./test-all.sh
```

Page logic across all three builds, route geometry, the schedule state machine sampled
every six hours across the whole voyage, estimate generation, the interface, zoom limits,
server endpoints and caching, the Action script's guards, and repo hygiene.

They run headless by loading each page's IIFE into a fake DOM (`tests/harness.js`) and
exposing its internals. There is no browser in the loop, so anything genuinely visual
still needs eyes on it.

**Paths are relative, and missing builds are skipped, not failed.** `tests/paths.js`
works out where the builds are from its own location. It handles both layouts: this
`SaS` directory with `wo-pages/` and `odyssey/` side by side, where everything runs, and
a bare clone of the Pages repo on its own, where the two suites that need the other
builds stand down and say so. That matters because the published repo *is* the Pages
build at its root, with no `odyssey/` in it, so a cloner who runs the battery would
otherwise get a wall of failures for files that were never meant to be there.

Counts depend on what is present: 157 from this directory, 131 from a bare clone. The
original 195 assumed all three builds plus a machine with Node.

**Node is preferred, Deno is accepted.** `test-all.sh` detects which is installed. The
server suite needs Node specifically, since it boots `server.js`, and skips without it.

**The standalone build is not on disk anywhere.** `world-odyssey-tracker-v4.html` only
ever existed in the session sandbox that built it. Its structure tests skip. If you want
it back, rebuild it from the Pages build by inlining `earth.webp` as a base64 data URI
and removing the two `fetch` calls.

---

## 9. Known limitations

* **aisstream is terrestrial only.** Roughly 40nm from a receiving station. The long
  crossings (Tangier to Salvador, Salvador to St Helena, St Helena to Cape Town, Cape Town
  to Port Louis, Port Louis to Colombo) will produce no fixes at all. This is normal and
  the page handles it by falling back to dead reckoning. Satellite AIS for one vessel
  starts around £100/month via MarineTraffic Essential.
* **Scheduled workflows are best-effort.** Expect roughly 20 of 24 hourly runs to fire.
* **The port itinerary list is driven by the timetable, not by position.** If she arrives
  late, the list still says "alongside now" at the scheduled hour while the map is honest.
  This was flagged to the user as the obvious next improvement and not yet built.
* **Coastlines are Natural Earth 50m.** Good enough to draw, not a navigational margin.
* **WebP needs iOS 14 or newer.**

---

## 10. Open items

1. Tie the itinerary list to real position rather than the clock. Mark a port alongside
   only when a fix puts her within a few miles of it, show "due 08:00" until then.
2. Add a web app manifest and a service worker so Add to Home Screen gives an icon, a
   splash and offline loading. Discussed, not built.
3. Consider a PWA install prompt on Android.
4. The itinerary is marked "subject to change 01/14/2026" in the source PDF. If the ship
   reroutes, the `PORTS` array and the `WAYPOINTS` array both need updating, in all three
   page builds.

---

## 11. Bootstrap prompt for a new session

> I'm continuing work on a ship tracker for the MV World Odyssey. Read HANDOFF.md in this
> directory first, then `tests/test-all.sh` should pass before and after any change I ask
> for. The page exists in three builds that must stay in sync: `docs/index.html` here,
> plus the standalone and server copies described in the handoff. Do not add map
> libraries, tiles or iframes, and do not label dead-reckoned positions as reported ones.
