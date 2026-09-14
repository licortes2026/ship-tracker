# World Odyssey tracker, no server

An hourly GitHub Action fetches one AIS position and commits it. GitHub Pages serves
the page and the data. Nothing of yours has to stay running.

## Setup, once

**1. Get a free AIS key**
Register at https://aisstream.io/authenticate and copy the key.

**2. Create the repo**
Make a new **public** repository on GitHub. Public matters: Actions minutes are
unlimited on public repos, and a private one would run out partway through the voyage.
Keep the name neutral, e.g. `ship-track`, not `semester-at-sea-tracker`.

**3. Push these files**

    cd wo-pages && git init && git add -A && git commit -m "initial" \
      && git branch -M main \
      && git remote add origin https://github.com/YOURNAME/YOURREPO.git \
      && git push -u origin main

**4. Add the key as a secret**
Repo → Settings → Secrets and variables → Actions → New repository secret.
Name it exactly `AISSTREAM_API_KEY`. Paste the key. Never commit the key itself.

**5. Turn on Pages**
Repo → Settings → Pages → Source: *Deploy from a branch* → Branch: `main`, folder `/docs`.
Your link appears a minute later at `https://YOURNAME.github.io/YOURREPO/`.

**6. Allow the Action to commit**
Repo → Settings → Actions → General → Workflow permissions →
*Read and write permissions*. Save.

**7. Run it once by hand**
Actions tab → "Track the World Odyssey" → Run workflow. Watch the log. It either
prints a position or says she is out of terrestrial range, which is a normal result.

## What runs

`.github/workflows/track.yml` fires on the hour. It opens a websocket to aisstream,
listens 75 seconds, and writes `docs/position.json` and `docs/track.json`. If nothing
changed, it commits nothing.

## What the page does

Loads `track.json` once, then asks for `position.json` hourly. That file is a few
hundred bytes. It also sends a HEAD request for itself and reloads only if the ETag
changed, so a redeploy reaches open pages without downloading the page every hour.

## Things that will happen

* **Silent legs.** aisstream is terrestrial. Expect nothing between Tangier and
  Salvador, or Salvador and Cape Town. The line stops and resumes. The marker falls
  back to schedule-based dead reckoning and labels itself as estimated.
* **Missed hours.** Scheduled workflows are best-effort. Some runs are late, some are
  skipped under load.
* **Commit noise.** One commit per hour that produces a new fix. Harmless, and it also
  keeps the repo active, which stops GitHub disabling the schedule for inactivity.
* **Nothing is discarded.** `docs/log.jsonl` is append-only and holds every fix for the
  whole voyage. `docs/track.json` is rebuilt from it each run, so the two cannot drift.
  One fix an hour for 104 days is at most ~2,500 lines, under 200KB. Git history is a
  second copy: every hourly commit is a restorable snapshot, so even a bad run that
  corrupted a file could be rolled back.

## Tests

    cd tests && ./test-all.sh

Needs Node, or Deno if you have that instead. Nothing else, and no network. The
suites load the page's script into a fake DOM and check the route geometry, the
schedule, the estimate drawing, the interface and the Action's guards.

The server build in `odyssey/` is picked up automatically and its suite runs too,
provided Node is installed. The standalone single-file build lives outside this
repo, so its few structure checks say they are skipping.

## The server alternative

`odyssey/` holds the same page served by a small Node process instead of GitHub
Pages. It collects far more positions, because it listens continuously rather than
for 75 seconds an hour, but it needs a machine that stays on. See `odyssey/README.md`.
You do not need it to run the tracker — the Pages build above is self-sufficient.

## Licensing

Code, text and design under Apache 2.0, see `LICENSE` and `NOTICE`.
Earth imagery NASA Blue Marble, coastlines Natural Earth, both public domain.
Not affiliated with Semester at Sea, the Institute for Shipboard Education, Colorado
State University, or the vessel's owners or operators.
