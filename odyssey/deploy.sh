#!/bin/bash
# Deploy the World Odyssey tracker to a server and print the shareable link.
#
#   ./deploy.sh root@203.0.113.10                 plain HTTP on port 8787
#   ./deploy.sh root@203.0.113.10 odyssey.yoursite.com    HTTPS via Caddy
#
# Safe to run repeatedly. It never touches an existing web server config it did not write.

set -eu
cd "$(dirname "$0")"

TARGET="${1:-}"
DOMAIN="${2:-}"
REMOTE_DIR="/opt/odyssey"

if [ -z "$TARGET" ]; then
  echo "Usage: ./deploy.sh user@host [domain]"
  exit 1
fi

if command -v xattr >/dev/null 2>&1; then xattr -dr com.apple.quarantine . >/dev/null 2>&1 || true; fi
chmod +x deploy.sh install.sh server.js 2>/dev/null || true

echo ""
echo "  Deploying to $TARGET"
echo ""

# --- the API key travels separately from the code ---
if [ ! -f .aisstream-key ]; then
  echo "  No .aisstream-key here. Get a free one at https://aisstream.io/authenticate"
  printf "  Paste your key: "
  read -r KEY
  [ -z "$KEY" ] && { echo "  No key, stopping."; exit 1; }
  printf "%s" "$KEY" > .aisstream-key
  chmod 600 .aisstream-key
fi

echo "  Copying files..."
ssh "$TARGET" "mkdir -p $REMOTE_DIR/public $REMOTE_DIR/data"
if command -v rsync >/dev/null 2>&1; then
  rsync -az --delete --exclude node_modules --exclude data \
    ./server.js ./package.json ./README.md ./public "$TARGET:$REMOTE_DIR/"
else
  scp -q server.js package.json README.md "$TARGET:$REMOTE_DIR/"
  scp -q public/index.html "$TARGET:$REMOTE_DIR/public/"
fi
scp -q .aisstream-key "$TARGET:$REMOTE_DIR/.aisstream-key"
ssh "$TARGET" "chmod 600 $REMOTE_DIR/.aisstream-key"

echo "  Setting up the service..."
ssh "$TARGET" "DOMAIN='$DOMAIN' REMOTE_DIR='$REMOTE_DIR' bash -s" <<'REMOTE'
set -eu

if ! command -v node >/dev/null 2>&1; then
  echo "    Installing Node..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y nodejs >/dev/null 2>&1
fi
echo "    Node $(node -v)"

cd "$REMOTE_DIR"
npm install --silent --no-audit --no-fund ws >/dev/null 2>&1

cat > /etc/systemd/system/odyssey.service <<UNIT
[Unit]
Description=World Odyssey AIS track server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$REMOTE_DIR
ExecStart=/usr/bin/node $REMOTE_DIR/server.js
Environment=ODYSSEY_PORT=8787
Restart=always
RestartSec=5
StandardOutput=append:$REMOTE_DIR/data/server.log
StandardError=append:$REMOTE_DIR/data/server.log

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable odyssey >/dev/null 2>&1
systemctl restart odyssey
sleep 2
systemctl is-active --quiet odyssey && echo "    Service running." || { echo "    Service failed. journalctl -u odyssey -n 40"; exit 1; }

if [ -n "$DOMAIN" ]; then
  if ! command -v caddy >/dev/null 2>&1; then
    if ss -ltn 2>/dev/null | grep -qE ':(80|443) '; then
      echo "    Ports 80 or 443 are already taken by something else."
      echo "    Not touching it. Reverse proxy $DOMAIN to 127.0.0.1:8787 yourself,"
      echo "    or rerun without the domain to use the plain port."
      exit 0
    fi
    echo "    Installing Caddy..."
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl >/dev/null 2>&1
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      > /etc/apt/sources.list.d/caddy-stable.list 2>/dev/null
    apt-get update >/dev/null 2>&1
    apt-get install -y caddy >/dev/null 2>&1
  fi

  mkdir -p /etc/caddy/sites
  grep -q 'import sites/\*' /etc/caddy/Caddyfile 2>/dev/null || echo 'import sites/*' >> /etc/caddy/Caddyfile
  cat > /etc/caddy/sites/odyssey <<SITE
$DOMAIN {
    encode gzip
    reverse_proxy 127.0.0.1:8787
}
SITE
  systemctl reload caddy 2>/dev/null || systemctl restart caddy
  echo "    Caddy serving $DOMAIN with automatic HTTPS."
else
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then
    ufw allow 8787/tcp >/dev/null 2>&1 || true
    echo "    Opened port 8787 in ufw."
  fi
fi
REMOTE

HOST="${TARGET#*@}"
echo ""
if [ -n "$DOMAIN" ]; then
  echo "  Share this:  https://$DOMAIN"
  echo "  Point an A record for $DOMAIN at $HOST first if you have not already."
else
  echo "  Share this:  http://$HOST:8787"
fi
echo ""
echo "  Logs:     ssh $TARGET 'journalctl -u odyssey -f'"
echo "  Restart:  ssh $TARGET 'systemctl restart odyssey'"
echo "  Track:    ssh $TARGET 'wc -l $REMOTE_DIR/data/positions.jsonl'"
echo ""
