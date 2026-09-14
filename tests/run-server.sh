#!/bin/bash
# Exercises the track server end to end against a seeded log.
#
# The server build is a separate directory beside this repo, and is not part of a
# Pages-only clone. When it is not there, say so and pass: there is nothing to
# test, which is not the same as a failure.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ODYSSEY="$(cd "$HERE/../.." && pwd)/odyssey"
if [ ! -f "$ODYSSEY/server.js" ]; then
  echo "10-11. Server endpoints and caching"
  echo "   - server build not present at $ODYSSEY, skipped"
  exit 0
fi
if ! command -v node >/dev/null 2>&1; then
  echo "10-11. Server endpoints and caching"
  echo "   - node not installed, server suite skipped"
  exit 0
fi
cd "$ODYSSEY" || exit 1
mkdir -p data
PASS=0; FAIL=0
chk(){ if [ "$2" = "$3" ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "   FAIL: $1 (got '$2', wanted '$3')"; fi; }
chkgt(){ if [ "$2" -gt "$3" ] 2>/dev/null; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "   FAIL: $1 (got '$2', wanted > $3)"; fi; }

npm install --silent --no-audit --no-fund ws >/dev/null 2>&1
printf 'testkey' > .aisstream-key
python3 - <<'PY'
import json,time
now=int(time.time()*1000); lat,lon=52.4,4.5; out=[]
for i in range(3000):
    lat-=0.012; lon-=0.005
    out.append(json.dumps({"t":now-(3000-i)*600000,"lat":round(lat,4),"lon":round(lon,4),"sog":13.2,"cog":211}))
open('data/positions.jsonl','w').write("\n".join(out)+"\n")
PY
(node server.js > /tmp/srv.log 2>&1 &)
sleep 3

echo "10. Server endpoints"
chk "page returns 200"        "$(curl -s -o /dev/null -w '%{http_code}' localhost:8787/)" "200"
chk "unknown path returns 404" "$(curl -s -o /dev/null -w '%{http_code}' localhost:8787/nope)" "404"
chk "traversal is refused"     "$(curl -s -o /dev/null -w '%{http_code}' --path-as-is 'localhost:8787/../../etc/passwd')" "403"
chk "image is served"          "$(curl -s -o /dev/null -w '%{http_code}' localhost:8787/earth.webp)" "200"

POS=$(curl -s localhost:8787/position.json)
chk "position.json is tiny"    "$(echo -n "$POS" | wc -c | tr -d ' ' | awk '{print ($1<600)?"yes":"no"}')" "yes"
chk "position.json counts the log" "$(echo "$POS" | python3 -c 'import json,sys;print(json.load(sys.stdin)["count"])')" "3000"
chk "position.json flags incremental" "$(echo "$POS" | python3 -c 'import json,sys;print(json.load(sys.stdin)["incremental"])')" "True"

chk "track thins to the cap"   "$(curl -s 'localhost:8787/track.json?max=1500' | python3 -c 'import json,sys;d=json.load(sys.stdin);print("yes" if d["returned"]<=1501 and d["thinned"] else "no")')" "yes"
chk "thinning keeps the newest fix" "$(curl -s 'localhost:8787/track.json?max=100' | python3 -c 'import json,sys;d=json.load(sys.stdin);print("yes" if d["points"][-1]["t"]==d["lastT"] else "no")')" "yes"
LAST=$(echo "$POS" | python3 -c 'import json,sys;print(json.load(sys.stdin)["lastT"])')
chk "since=newest returns nothing" "$(curl -s "localhost:8787/track.json?since=$LAST" | python3 -c 'import json,sys;print(json.load(sys.stdin)["returned"])')" "0"
chkgt "since=older returns some" "$(curl -s "localhost:8787/track.json?since=$((LAST-7200000))" | python3 -c 'import json,sys;print(json.load(sys.stdin)["returned"])')" "0"
chk "garbage query does not crash" "$(curl -s -o /dev/null -w '%{http_code}' 'localhost:8787/track.json?since=abc&max=-9')" "200"

echo "11. Caching and compression"
HDRS=$(curl -sI localhost:8787/)
chk "page must revalidate"    "$(echo "$HDRS" | grep -ci 'cache-control: no-cache')" "1"
chk "page carries an ETag"    "$(echo "$HDRS" | grep -ci 'etag')" "1"
IHDR=$(curl -sI localhost:8787/earth.webp)
chk "image caches for a year" "$(echo "$IHDR" | grep -ci 'immutable')" "1"
ETAG=$(echo "$HDRS" | grep -i etag | tr -d '\r' | cut -d' ' -f2)
chk "matching ETag gives 304" "$(curl -s -o /dev/null -w '%{http_code}' -H "If-None-Match: $ETAG" localhost:8787/)" "304"
RAW=$(curl -s localhost:8787/ | wc -c | tr -d ' ')
GZ=$(curl -s -H 'Accept-Encoding: gzip' localhost:8787/ --output - | wc -c | tr -d ' ')
echo "   page raw ${RAW} bytes, gzipped ${GZ} bytes"
chk "gzip actually shrinks it" "$(awk -v r=$RAW -v g=$GZ 'BEGIN{print (g<r/2)?"yes":"no"}')" "yes"

touch public/index.html; sleep 1
chk "after redeploy the old ETag is stale" "$(curl -s -o /dev/null -w '%{http_code}' -H "If-None-Match: $ETAG" localhost:8787/)" "200"

pkill -f "node server.js" >/dev/null 2>&1
rm -f .aisstream-key data/positions.jsonl
rm -rf node_modules package-lock.json
echo ""
echo "   server: $PASS passed, $FAIL failed"
exit $FAIL
