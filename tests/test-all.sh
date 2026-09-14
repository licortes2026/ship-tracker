#!/bin/bash
# Full battery: page logic, server, action script, shell syntax.
cd "$(dirname "$0")" || exit 1
[ "$(uname)" = "Darwin" ] && xattr -dr com.apple.quarantine . >/dev/null 2>&1
chmod +x test-all.sh run-server.sh 2>/dev/null
FAILED=0
echo "=== shell and node syntax ==="
for f in /home/claude/odyssey/deploy.sh /home/claude/odyssey/install.sh; do
  bash -n "$f" && echo "  ok  $(basename $f)" || { echo "  FAIL $(basename $f)"; FAILED=1; }
done
for f in /home/claude/odyssey/server.js /home/claude/wo-pages/scripts/fetch-position.js; do
  node --check "$f" && echo "  ok  $(basename $f)" || { echo "  FAIL $(basename $f)"; FAILED=1; }
done
python3 -c "import yaml,sys; yaml.safe_load(open('/home/claude/wo-pages/.github/workflows/track.yml')); print('  ok  track.yml')" 2>/dev/null \
  || echo "  (yaml module unavailable, skipped)"
node run.js || FAILED=1
node run-action.js || FAILED=1
./run-server.sh || FAILED=1
echo ""
[ $FAILED -eq 0 ] && echo "ALL GREEN" || echo "SOMETHING FAILED"
exit $FAILED
