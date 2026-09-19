# SPEC: how the chart draws where she has been and where she is going

Status: **live as of 2026-09-19, build v1.5.**
Supersedes the drawing rules in HANDOFF section 5.

---

## 1. The rule in one line

Consolidated history is yellow and ends on the newest AIS fix. It is solid where
the clock leaves her no room to have deviated from the direct line, dashed where
it is genuinely a reconstruction. The only crimson on the
chart is a single live estimate at the tip, and it never survives into history.

## 2. What each mark means

| Mark | Meaning | Element |
|---|---|---|
| Solid yellow | History whose trajectory is determined: she had no room to deviate. | `#real` |
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

### 3.1 Solid or dashed: how far could she possibly have strayed?

Elapsed time does not decide this. **Elapsed time against speed does.**

Take the two fixes as the foci of an ellipse whose major axis is the distance her
reported speed allows in the time. Every path she could have sailed lies inside
it, so the semi-minor axis is the furthest she could possibly be from the direct
line:

```
budget   = average reported speed x elapsed hours
straight = great-circle distance between the fixes
stray    = budget <= straight ? 0 : sqrt(budget^2 - straight^2) / 2

berth          if straight < 1 nm                     -> solid, straight
reconstructed  if route distance > straight x 1.25     -> dashed, warped
reconstructed  if no usable reported speed             -> dashed, warped
determined     if stray <= 10 nm                       -> solid, straight
reconstructed  otherwise                               -> dashed, warped
```

Ten miles of possible wander is a pixel or two at chart scale, so a straight
line is honest. Measured on the Leixões leg:

| Span | Elapsed | Straight | Could stray | Kind |
|---|---|---|---|---|
| port -> 1 | 107h | 705.8 nm | **243.3 nm** | reconstructed |
| 1 -> 2 | 9.16h | 73.3 nm | 0.0 nm | determined |
| 2 -> 3 | 2.74h | 22.9 nm | 0.0 nm | determined |
| 3 -> 4 | 1.29h | 9.8 nm | 1.5 nm | determined |
| 4 -> 5 | 16.06h | 133.8 nm | **0.0 nm** | determined |
| 5 -> 6 | 1.09h | 6.0 nm | 2.1 nm | determined |
| 6 -> 12 | hourly | < 0.5 nm | - | berth |

**The 16-hour silence is determined, not a guess.** 133.8 nm in 16.06 hours needs
8.33 kt and she reported 8.3 and 8.2 either side: the straight line consumed
every mile available, so she cannot have deviated. The earlier 90-minute rule
called that a reconstruction, which was wrong, and drew it as a curve.

A ratio of speeds cannot express this. An hourly fix at 13 kt that advanced 6 nm
has slack in ratio terms but could only have strayed 5.7 nm, which is nothing.

**Why the route-distance clause.** When the direct line crosses land the real
distance is longer than the straight line and the stray figure is meaningless.
The planned route was drawn around land, so a route distance much longer than
the straight line reveals the shortcut. It is a cheap safety net rather than a
land test: the IJmuiden run is caught by its 243 nm of stray anyway.

### 3.1a A reconstruction may not exceed her speed

A warped span follows the planned route's shape, which can add distance she did
not have. On the real 16-hour gap the warp drew **143.6 nm against a 132.5 nm
budget** — eleven miles of voyage that could not have happened.

Reconstructions are now blended toward the straight line until they fit the
budget. The blend cannot move either endpoint, because the warp and the straight
line already agree at both ends.

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

* Direction: **along the planned route**, re-originated from the fix with the same
  fading correction as section 5, converging over 60 nm. Not her last reported
  course: a heading is true only until she alters it, and over a five-day crossing
  it would sail her into Africa. And not a direct bearing to the next port either,
  which was the rule until 2026-09-19 and put her inland. From the 18 Sep 20:17 fix
  off Leixoes the bearing to Tangier crossed Portugal, and the marker was drawn
  near Coimbra. Section 5 already rejected direct bearings for the forward route
  for exactly this reason; section 4 now uses the same machinery.
* The run begins exactly on the fix. At its first step the correction is at full
  strength, so there is no sideways jump onto the planned line.
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
