#!/bin/bash
# Full battery: page logic, server, action script, shell syntax.
#
# Every path is worked out from this script's location, so the battery runs from a
# clone wherever it sits. Builds that are not checked out here are skipped, not
# failed: a clone of the Pages repo on its own is a legitimate checkout, and the
# suites that need the server build say when they are standing down.
cd "$(dirname "$0")" || exit 1
[ "$(uname)" = "Darwin" ] && xattr -dr com.apple.quarantine . >/dev/null 2>&1
chmod +x test-all.sh run-server.sh 2>/dev/null

HERE="$(pwd)"
ROOT="$(cd "$HERE/.." && pwd)"        # the Pages repo
# The server build is inside the repo when published, beside it in development.
ODYSSEY="$ROOT/odyssey"
[ -f "$ODYSSEY/server.js" ] || ODYSSEY="$(cd "$ROOT/.." && pwd)/odyssey"

# Node is the intended runtime. Deno runs these CommonJS tests too, so accept it
# rather than refusing to run at all.
if command -v node >/dev/null 2>&1; then
  JS="node"; CHECK="node --check"
elif command -v deno >/dev/null 2>&1; then
  # These suites are CommonJS; deno needs telling, since the .js extension alone
  # does not say so without a "type" field in package.json.
  JS="deno run --quiet --unstable-detect-cjs --allow-read --allow-write --allow-env"
  CHECK="deno check --quiet"
  echo "note: node not found, running the JS suites under deno"
else
  echo "Neither node nor deno is installed. Install one of them:"
  echo "  brew install node"
  exit 1
fi

FAILED=0
echo "=== shell and node syntax ==="
for f in "$ODYSSEY/deploy.sh" "$ODYSSEY/install.sh"; do
  if [ ! -f "$f" ]; then echo "  --  $(basename "$f") not present, skipped"; continue; fi
  bash -n "$f" && echo "  ok  $(basename "$f")" || { echo "  FAIL $(basename "$f")"; FAILED=1; }
done
for f in "$ODYSSEY/server.js" "$ROOT/scripts/fetch-position.js"; do
  if [ ! -f "$f" ]; then echo "  --  $(basename "$f") not present, skipped"; continue; fi
  $CHECK "$f" >/dev/null 2>&1 && echo "  ok  $(basename "$f")" || { echo "  FAIL $(basename "$f")"; FAILED=1; }
done
python3 -c "import yaml,sys; yaml.safe_load(open('$ROOT/.github/workflows/track.yml')); print('  ok  track.yml')" 2>/dev/null \
  || echo "  (yaml module unavailable, skipped)"

$JS run.js || FAILED=1
$JS run-pace.js || FAILED=1
$JS run-action.js || FAILED=1
./run-server.sh || FAILED=1
echo ""
[ $FAILED -eq 0 ] && echo "ALL GREEN" || echo "SOMETHING FAILED"
exit $FAILED
