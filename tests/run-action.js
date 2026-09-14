// Tests the GitHub Action fetcher's decision logic without any network.
const fs = require("fs");
const path = require("path");
const os = require("os");

let pass = 0, fail = 0; const failures = [];
function ok(n, c, d){ if (c) pass++; else { fail++; failures.push(n + (d ? "  -> " + d : "")); } }

const SRC = fs.readFileSync("/home/claude/wo-pages/scripts/fetch-position.js", "utf8");

console.log("\n12. Action script");
ok("no key means a clean exit, not a crash", /No AISSTREAM_API_KEY/.test(SRC));
ok("the key is never written to disk", !/writeFileSync\([^)]*KEY/.test(SRC));
ok("the key comes only from the environment", /process\.env\.AISSTREAM_API_KEY/.test(SRC));
ok("the log is append-only", /appendFileSync\(LOG/.test(SRC));
ok("nothing prunes the log", !/prune\(/.test(SRC));
ok("track.json is rebuilt from the log", /const points = readLog\(\)/.test(SRC));
ok("torn log lines are skipped rather than fatal", /catch \(e\) \{ return null; \}/.test(SRC));
ok("out of range is a normal result", /out of terrestrial range/.test(SRC));
ok("duplicate fixes are rejected", /moved < 0\.3/.test(SRC));
ok("implausible jumps are rejected", /moved > 900/.test(SRC));
ok("listening window is bounded", /LISTEN_SECONDS/.test(SRC));
ok("coordinates are sanity checked", /Math\.abs\(r\.Latitude\) > 90/.test(SRC));

// Re-implement the two guards exactly as written and check they behave.
function nm(a, b){
  const R = 3440.065, d = Math.PI/180;
  const la1=a.lat*d, la2=b.lat*d, dla=la2-la1, dlo=(b.lon-a.lon)*d;
  const h = Math.sin(dla/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dlo/2)**2;
  return 2*R*Math.asin(Math.min(1, Math.sqrt(h)));
}
function decide(last, best){
  const moved = last ? nm(last, best) : Infinity;
  const mins = last ? (best.t - last.t)/60000 : Infinity;
  if (moved < 0.3 && mins < 45) return "skip";
  if (last && moved > 900 && mins < 60) return "drop";
  return "append";
}
const base = { t: 1000000, lat: 40, lon: -10 };
ok("first ever fix is appended", decide(null, base) === "append");
ok("same berth ten minutes later is skipped",
   decide(base, { t: base.t + 600000, lat: 40.001, lon: -10.001 }) === "skip");
ok("same spot but an hour later is still recorded",
   decide(base, { t: base.t + 3600000, lat: 40.001, lon: -10.001 }) === "append");
ok("normal hourly movement is appended",
   decide(base, { t: base.t + 3600000, lat: 40.2, lon: -10.1 }) === "append");
ok("teleport across the world is dropped",
   decide(base, { t: base.t + 600000, lat: -30, lon: 150 }) === "drop");
ok("a big move over a long gap is kept",
   decide(base, { t: base.t + 5*86400000, lat: -30, lon: 20 }) === "append");

// log round trip
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wo-"));
const log = path.join(tmp, "log.jsonl");
const rows = [];
for (let i = 0; i < 2496; i++) rows.push(JSON.stringify({ t: 1e12 + i*3600000, lat: 50 - i*0.01, lon: i*0.01, sog: 13, cog: 200 }));
fs.writeFileSync(log, rows.join("\n") + "\n");
fs.appendFileSync(log, '{"t":999,"lat":  broken\n');           // a torn line
fs.appendFileSync(log, JSON.stringify({ t: 1e12 + 2496*3600000, lat: 20, lon: 30 }) + "\n");
const parsed = fs.readFileSync(log, "utf8").split("\n").filter(Boolean)
  .map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
  .filter(p => p && typeof p.lat === "number" && typeof p.lon === "number")
  .sort((a,b) => a.t - b.t);
ok("a torn line does not lose the rest of the log", parsed.length === 2497, parsed.length + " parsed");
ok("a whole voyage of hourly fixes stays small",
   fs.statSync(log).size < 300000, Math.round(fs.statSync(log).size/1024) + " KB");
fs.rmSync(tmp, { recursive: true, force: true });

console.log("\n13. Workflow and repo hygiene");
const YML = fs.readFileSync("/home/claude/wo-pages/.github/workflows/track.yml", "utf8");
ok("runs hourly", /cron: "0 \* \* \* \*"/.test(YML));
ok("can be run by hand", /workflow_dispatch/.test(YML));
ok("has write permission to commit", /contents: write/.test(YML));
ok("will not overlap itself", /concurrency/.test(YML));
ok("has a timeout", /timeout-minutes/.test(YML));
ok("key comes from repo secrets", /secrets\.AISSTREAM_API_KEY/.test(YML));
ok("key is not hardcoded anywhere", !/[A-Za-z0-9]{32,}/.test(YML.replace(/uses:.*/g, "")));
ok("commits the permanent log", /docs\/log\.jsonl/.test(YML));
ok("commits nothing when nothing changed", /git diff --staged --quiet/.test(YML));

for (const repo of ["/home/claude/wo-pages", "/home/claude/odyssey"]){
  const gi = fs.existsSync(path.join(repo, ".gitignore")) ? fs.readFileSync(path.join(repo, ".gitignore"), "utf8") : "";
  ok(path.basename(repo) + ": ignores node_modules", /node_modules/.test(gi));
  ok(path.basename(repo) + ": has a LICENSE", fs.existsSync(path.join(repo, "LICENSE")));
  ok(path.basename(repo) + ": licence is Apache",
     /Apache License/.test(fs.readFileSync(path.join(repo, "LICENSE"), "utf8")));
  ok(path.basename(repo) + ": no key file present", !fs.existsSync(path.join(repo, ".aisstream-key")));
}
ok("server repo ignores the key file",
   /aisstream-key/.test(fs.readFileSync("/home/claude/odyssey/.gitignore", "utf8")));
ok("server repo ignores collected data",
   /data\//.test(fs.readFileSync("/home/claude/odyssey/.gitignore", "utf8")));

console.log("\n" + "=".repeat(52));
console.log(`  ${pass} passed, ${fail} failed`);
if (failures.length){ console.log("\n  Failures:"); failures.forEach(f => console.log("   - " + f)); }
console.log("=".repeat(52));
process.exit(fail ? 1 : 0);
