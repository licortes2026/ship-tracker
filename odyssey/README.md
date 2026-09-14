# World Odyssey track server

Listens to aisstream.io for MMSI 311000410, appends every fix to `data/positions.jsonl`,
and serves the tracker page with the real track drawn over the planned route.

## Install and run

    ./install.sh

It checks Node, asks once for a free aisstream.io API key, installs `ws`, and starts the
server at http://localhost:8787. Afterwards, double-click `start.command` to restart it.

## What is where

| File | Role |
|---|---|
| `server.js` | AIS listener plus the web server |
| `public/index.html` | The tracker page |
| `data/positions.jsonl` | Append-only fix log, one JSON object per line |
| `.aisstream-key` | Your API key, mode 600 |

## Endpoints

* `/` the tracker. Served with an ETag, so a page can ask "did this change?" in a HEAD request.
* `/position.json` the latest fix and a count. Around 270 bytes. This is what an open page asks for hourly.
* `/track.json` the track. `?max=N` thins it evenly for display (default 1500, newest fix always kept).
  `?since=MS` returns only fixes after that timestamp, which is how a page tops itself up.
* `/status.json` connection state and the latest fix.

A 4000-fix log is 262KB whole, 87KB thinned, and 278 bytes as an hourly top-up.

## Behaviour worth knowing

* A fix is stored when the ship has moved more than 0.5 nm or 10 minutes have passed.
  Jumps over 600 nm in under an hour are treated as bad data and dropped.
* aisstream is terrestrial. Expect silence on the ocean crossings. The log holds the last
  real fix and the line resumes when she comes back into range, so the gaps stay visible
  rather than being papered over.
* The page falls back to schedule-based dead reckoning when no fixes exist, and you can
  still type positions by hand at any time.
* The server must stay running to collect. On a laptop that sleeps, you will collect only
  while it is awake. A small always-on box, or your Hetzner instance, collects everything.

## Environment overrides

    ODYSSEY_PORT=9000 ODYSSEY_MMSI=311000410 node server.js

## Licensing

* Code, page text, layout and design: Apache License 2.0, see `LICENSE` and `NOTICE`.
* Earth imagery: NASA Blue Marble, public domain.
* Coastlines: Natural Earth, public domain.

Apache-2.0 licenses a "Work", meaning any work of authorship, so it covers the page text and
design as well as the code, and requires attribution through section 4. It adds an express
patent grant and, in section 6, makes clear that it grants no trademark rights, which matters
for a project that has to name ships and organisations it is not affiliated with — and the page
text is exactly where those names appear. One licence across one file, with no argument about
which half a given line belongs to.

## Before you publish this repo

* `.aisstream-key` and `data/` are gitignored. Check `git status` before the first commit anyway.
* If the key was ever committed, rotate it. Deleting the file does not remove it from history.
* This project is unaffiliated with Semester at Sea, the Institute for Shipboard Education, or
  Colorado State University. Keep the repo name neutral for the same reason.
