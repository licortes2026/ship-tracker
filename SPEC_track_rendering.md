# SPEC: how the chart draws where she has been and where she is going

Status: **drafted 2026-09-15, implemented as a local preview, not pushed.**
Supersedes the drawing rules in HANDOFF section 5.

---

## 1. The rule in one line

Consolidated history is yellow and ends on the newest AIS fix. A reconstructed
stretch is dashed, a densely-reported stretch is solid. The only crimson on the
chart is a single live estimate at the tip, and it never survives into history.

## 2. What each mark means

| Mark | Meaning | Element |
|---|---|---|
| Solid yellow | History between fixes reported close together. Near-observed. | `#real` |
| Dashed yellow | History across a silence. Reconstructed shape, real endpoints. | `#sailed` |
| Crimson dotted | The live estimate, last fix to now. At most one, always terminal. | `#est` |
| Grey dashed | Route still ahead, re-originated from her actual position. | `#planned` |
| Dots | One per AIS reading. Only ever on reported positions. | `#fixdots` |
| Ring | Yellow on a fresh fix, crimson when the position is estimated. | `#ship` |

**The clock-driven schedule line is gone.** It was `#sailed` drawn from the
timetable along the planned route, ignoring AIS entirely. It was the brightest
mark on the chart, had no legend entry, and read as her route. Whether she is
ahead or behind schedule is text under the map, not a line on it.

## 3. History: the chain

History is a chain of spans:

```
departure port -> fix 1 -> fix 2 -> ... -> newest fix
```

The departure port anchors the start because a departure is a known position.
The newest fix anchors the end. Every joint in the chain is a position somebody
actually reported.

### 3.1 Solid or dashed

A span is **solid** when the two fixes are close enough that little happened
between them, otherwise **dashed**:

```
solid  if  gap <= 90 minutes  OR  moved < 1 nm
dashed otherwise
```

The distance clause matters at a berth: six hourly readings from the same
bollard are two hours apart but she did not move, so there is nothing to
reconstruct and the line should not imply there was.

On the Leixões leg this yields dashed for the 4d 4h port-to-first-fix span, the
9.2h and 16.1h silences and the 2h berth gap, solid for the seven spans of an
hour or less.

### 3.2 The shape of a span

Between two fixes the line is **not** a straight line. It takes its shape from
the planned route, warped so that it starts and ends exactly on the two fixes:

```
sa, sb        = distance along the planned route of each fix's projection
da, db        = each fix's offset from the route at its own projection
point at f    = routePoint(sa + (sb-sa)*f) + da*(1-f) + db*f      f in [0,1]
```

At `f=0` the correction is exactly `da`, so the curve begins on fix A. At `f=1`
it is exactly `db`, so it ends on fix B. In between it follows the route's shape
while drifting smoothly from one offset to the other. No kink, no sideways jump
onto the planned line, and the coast's form is preserved because the planned
route already threads hand-placed sea waypoints around it.

**The warp cannot displace a confirmed fix.** It spans exactly one gap, between
that gap's own two endpoints, and never reaches past either. This replaces the
earlier "recalculate the previous 100-200 miles" idea, which could not know
where the neighbouring fixes were: working back 200 nm from fix 5 on this leg
reaches 166 nm and would have dragged fixes 4, 3 and 2 off their reported
positions. The gap is the natural unit and it is safe by construction.

### 3.3 Offshore clearance

Reconstructed spans should sit roughly **50-60 nm off the coast**, because that
is where she actually sails.

The warp approximates this without any coastline geometry: both endpoints are
real offshore positions, so `da` and `db` are real seaward offsets, and the
interpolation between them keeps the mid-span out to sea on the same side. It is
an approximation, not a guarantee.

Enforcing a true minimum clearance means measuring distance from each
reconstructed point to the Natural Earth coastline polygons baked into the page
and pushing the curve seaward where it falls short. That is real work — a
point-to-polygon distance pass on every redraw — and the coastlines are 50m
resolution, which the handoff already warns is "good enough to draw, not a
navigational margin". **Specified, not yet enforced.** The preview reports the
clearance it actually achieves so the gap between intent and behaviour stays
visible.

## 4. The live estimate

When the newest fix is older than 90 minutes, one crimson run is drawn from that
fix to where she probably is now:

* Direction: the great-circle bearing from the fix to the next port. Not her last
  reported course — a heading is true only until she alters it, and over a
  five-day crossing it would sail her into Africa.
* Speed: her last reported speed, falling back to the timetable's implied speed
  when that is unusable.
* Clamped at the port. Arithmetic that puts her past it means she has arrived.

**At most one crimson run exists and it always terminates at her current
position.** Nothing crimson is ever left behind in history.

**Estimates are never stored.** They are recomputed from the two real endpoints
on every redraw. Once a real fix lands, the estimates that preceded it are known
to be wrong — had she been there, the new fix would agree — so promoting them
into permanent history would bake in error that compounds over 104 days. And
`log.jsonl` stays pure AIS: it is append-only, never pruned, and the one
artefact that must not be polluted.

## 5. The route ahead

The grey dashed route is re-originated from her real position rather than drawn
from the timetable's:

```
start at her current position
converge onto the planned route over ~60 nm
follow the planned waypoints to the end of the voyage
```

The convergence uses the same fading correction as a history span, run forwards
instead of across a gap. It starts exactly where she is, so there is no jump,
and it rejoins the hand-placed waypoints rather than heading straight for the
port — a direct line from an offshore position would cut across headlands, and
Cape St Vincent on the Leixões-Tangier leg was specifically hand-fixed to round
to the west.

## 6. What this cannot fix

She sailed IJmuiden 9 Sep 20:26. The first AIS reading is 14 Sep 00:09. **Four
days and four hours of leg one were never recorded** — the collector did not
exist, and aisstream has no history to query. That span is drawn dashed from the
port to the first fix, which is honest about being a reconstruction, but it is a
reconstruction of 85% of the leg. From Tangier onward the collector runs
continuously and this does not recur.

## 7. Invariants worth testing

1. No crimson segment exists anywhere except the final run to the current position.
2. Every joint in the yellow chain is an exact AIS coordinate or a port.
3. A warped span's first and last points equal its two endpoint fixes exactly.
4. A warped span never moves any other fix.
5. Spans of 90 minutes or less, or under 1 nm, are solid; the rest are dashed.
6. The forward route's first point is her current position.
7. Nothing is written to `log.jsonl` but AIS readings.
