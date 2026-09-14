#!/bin/bash
# World Odyssey tracker. Installs dependencies, stores your AIS key, starts the server.
# Usage:  ./install.sh

set -u
cd "$(dirname "$0")" || exit 1

echo ""
echo "  World Odyssey track server"
echo "  =========================="
echo ""

# Clear macOS quarantine on everything shipped here, so nothing needs a permissions step.
if command -v xattr >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine . >/dev/null 2>&1
fi
chmod +x install.sh server.js start.command 2>/dev/null

if ! command -v node >/dev/null 2>&1; then
  echo "  Node is not installed. With Homebrew:  brew install node"
  echo "  Without Homebrew, the installer at https://nodejs.org/en/download works fine."
  exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 16 ]; then
  echo "  Node $(node -v) is too old. Version 16 or newer, please."
  exit 1
fi
echo "  Node $(node -v) found."

if [ ! -f .aisstream-key ]; then
  echo ""
  echo "  This needs a free aisstream.io API key. I cannot create one for you,"
  echo "  it takes about a minute at:  https://aisstream.io/authenticate"
  echo ""
  printf "  Paste your key here: "
  read -r KEY
  if [ -z "$KEY" ]; then
    echo "  No key entered. Run ./install.sh again when you have one."
    exit 1
  fi
  printf "%s" "$KEY" > .aisstream-key
  chmod 600 .aisstream-key
  echo "  Key saved to .aisstream-key"
fi

echo "  Installing the websocket library..."
npm install --silent --no-audit --no-fund ws >/dev/null 2>&1 || {
  echo "  npm install failed. Try running it yourself:  npm install ws"
  exit 1
}

mkdir -p data

cat > start.command <<'LAUNCHER'
#!/bin/bash
cd "$(dirname "$0")" || exit 1
node server.js
LAUNCHER
chmod +x start.command

echo ""
echo "  Done. Starting the server now."
echo "  Tracker:  http://localhost:8787"
echo "  Stop it with Control-C. Restart later by double-clicking start.command"
echo ""

sleep 1
if command -v open >/dev/null 2>&1; then
  ( sleep 2 && open http://localhost:8787 ) &
fi

exec node server.js
