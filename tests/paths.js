// Where the three builds live, worked out from this file's own location.
//
// The battery was originally written against absolute sandbox paths, which meant
// it only ran on the machine it was written on. Everything here is relative, so
// a clone works wherever it is put.
//
// Two layouts are supported:
//
//   ship-tracker/              the published repo. The server build sits inside
//     docs/index.html          it, so both are found.
//     tests/
//     odyssey/
//       public/index.html
//
//   SaS/                       both builds side by side, as the project was
//     wo-pages/                developed. Also works.
//       docs/index.html
//       tests/
//     odyssey/
//       public/index.html
//     world-odyssey-tracker-v4.html

const fs = require("fs");
const path = require("path");

const HERE = __dirname;
const ROOT = path.resolve(HERE, "..");        // the Pages repo
const NEXT = path.resolve(ROOT, "..");        // its parent, where sibling builds sit

// The server build lives inside the repo when published, and beside it in the
// development directory. Check both, in that order. It is only believed if it
// has a server in it, so an unrelated directory called "odyssey" cannot
// masquerade as one.
const ODYSSEY = [path.join(ROOT, "odyssey"), path.join(NEXT, "odyssey")]
  .find(d => fs.existsSync(path.join(d, "server.js"))) || path.join(ROOT, "odyssey");
const hasServerRepo = fs.existsSync(path.join(ODYSSEY, "server.js"));

function firstThatExists(candidates){
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return null;
}

const FOUND = {
  standalone: firstThatExists([
    path.join(ROOT, "world-odyssey-tracker-v4.html"),
    path.join(NEXT, "world-odyssey-tracker-v4.html")
  ]),
  server: hasServerRepo ? firstThatExists([path.join(ODYSSEY, "public", "index.html")]) : null,
  pages: firstThatExists([
    path.join(ROOT, "docs", "index.html"),
    path.join(NEXT, "wo-pages", "docs", "index.html")
  ])
};

const BUILDS = {};
const MISSING = [];
for (const [name, file] of Object.entries(FOUND)){
  if (file) BUILDS[name] = file; else MISSING.push(name);
}

// The geometry and schedule suites only need one copy of the page logic, since
// all three builds share it. Prefer the standalone as the original harness did,
// then fall back to whichever build is here.
const HARNESS = BUILDS.standalone || BUILDS.pages || BUILDS.server;
if (!HARNESS){
  console.error("No page build found. Expected docs/index.html in " + ROOT);
  process.exit(1);
}

// The estimate suite needs a build that actually carries the AIS code. The
// standalone has none, so it cannot stand in here.
const AIS_BUILD = BUILDS.pages || BUILDS.server;
if (!AIS_BUILD){
  console.error("No build with AIS support found. Expected docs/index.html in " + ROOT);
  process.exit(1);
}

module.exports = { ROOT, NEXT, ODYSSEY, hasServerRepo, BUILDS, MISSING, FOUND, HARNESS, AIS_BUILD };
