#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Katab KRC — Node Agent Setup
# ═══════════════════════════════════════════════════════════════
#
#  Installs and configures KRC on this machine as a test node.
#
#  Usage:
#    ./setup-node.sh <server-ip>                      # Setup with defaults (web only)
#    ./setup-node.sh <server-ip> --platforms web,ios   # Include iOS testing
#    ./setup-node.sh <server-ip> --name my-mac         # Custom node name
#
#  Or one-liner from GitHub:
#    curl -fsSL https://raw.githubusercontent.com/Dubbi96/KRC/main/setup-node.sh | bash -s -- <server-ip>
#
# ═══════════════════════════════════════════════════════════════

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

log()  { echo -e "${GREEN}[KRC]${NC} $1"; }
warn() { echo -e "${YELLOW}[KRC]${NC} $1"; }
err()  { echo -e "${RED}[KRC]${NC} $1"; }
sep()  { echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}"; }

# ─── Parse Arguments ─────────────────────────────────────
SERVER_IP=""
NODE_NAME="$(hostname -s 2>/dev/null || hostname)"
PLATFORMS="web"
PORT=5001
KRC_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platforms) PLATFORMS="$2"; shift 2 ;;
    --name)      NODE_NAME="$2"; shift 2 ;;
    --port)      PORT="$2"; shift 2 ;;
    --dir)       KRC_DIR="$2"; shift 2 ;;
    -*)          err "Unknown option: $1"; exit 1 ;;
    *)
      if [ -z "$SERVER_IP" ]; then
        SERVER_IP="$1"
      fi
      shift
      ;;
  esac
done

if [ -z "$SERVER_IP" ]; then
  echo ""
  echo -e "${BOLD}Katab KRC Node Setup${NC}"
  echo ""
  echo "Usage: $0 <server-ip> [options]"
  echo ""
  echo "  <server-ip>             IP address of the Katab central server"
  echo "  --platforms web,ios     Platforms to support (default: web)"
  echo "  --name my-node          Node name (default: hostname)"
  echo "  --port 5001             Local API port (default: 5001)"
  echo "  --dir ./KRC             Installation directory (default: ./KRC)"
  echo ""
  echo "Examples:"
  echo "  $0 192.168.1.100"
  echo "  $0 192.168.1.100 --platforms web,ios --name mac-studio"
  echo ""
  exit 1
fi

# ─── Banner ──────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}  Katab KRC — Node Agent Setup${NC}"
sep
echo -e "  Server:     ${BOLD}${SERVER_IP}${NC}"
echo -e "  Node Name:  ${BOLD}${NODE_NAME}${NC}"
echo -e "  Platforms:  ${BOLD}${PLATFORMS}${NC}"
echo -e "  Port:       ${BOLD}${PORT}${NC}"
sep
echo ""

# ─── Prerequisite Check ─────────────────────────────────
check_prereqs() {
  local ok=true

  if ! command -v node &>/dev/null; then
    err "Node.js is required. Install: https://nodejs.org/ (v20+)"
    ok=false
  else
    local node_ver
    node_ver=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$node_ver" -lt 18 ]; then
      err "Node.js 18+ required (found: $(node -v))"
      ok=false
    fi
  fi

  if ! command -v npm &>/dev/null; then
    err "npm is required (comes with Node.js)"
    ok=false
  fi

  if ! command -v git &>/dev/null; then
    err "git is required. Install: https://git-scm.com/"
    ok=false
  fi

  # Platform-specific checks
  if [[ "$PLATFORMS" == *"ios"* ]]; then
    if ! command -v xcrun &>/dev/null; then
      warn "xcrun not found — iOS testing requires Xcode Command Line Tools"
      warn "  Install: xcode-select --install"
    fi
  fi

  if [[ "$PLATFORMS" == *"android"* ]]; then
    if ! command -v adb &>/dev/null; then
      warn "adb not found — Android testing requires Android SDK Platform Tools"
    fi
  fi

  if ! $ok; then exit 1; fi
  log "Prerequisites OK (Node.js $(node -v))"
}
check_prereqs

# ─── Clone or Update KRC ────────────────────────────────
if [ -z "$KRC_DIR" ]; then
  # Determine if we're already inside a KRC clone
  if [ -f "package.json" ] && grep -q '"name".*krc\|katab-runner' package.json 2>/dev/null; then
    KRC_DIR="$(pwd)"
    log "Using existing KRC directory: $KRC_DIR"
  elif [ -d "KRC" ]; then
    KRC_DIR="$(pwd)/KRC"
    log "Found existing KRC directory"
  else
    KRC_DIR="$(pwd)/KRC"
  fi
fi

if [ ! -d "$KRC_DIR/.git" ]; then
  log "Cloning KRC from GitHub..."
  git clone https://github.com/Dubbi96/KRC.git "$KRC_DIR" 2>&1 | tail -3
else
  log "Updating KRC..."
  (cd "$KRC_DIR" && git pull --ff-only 2>&1 | tail -3) || warn "Git pull failed — using existing version"
fi

cd "$KRC_DIR"

# ─── Install Dependencies ───────────────────────────────
log "Installing dependencies..."
npm install --silent 2>&1 | tail -3
echo ""

# ─── Register with KCD and get Runner Token ─────────────
log "Registering with Katab server..."

# Check if KCD is reachable
if ! curl -sf "http://${SERVER_IP}:4000/api/v1" >/dev/null 2>&1; then
  if ! curl -sf "http://${SERVER_IP}/api/v1" >/dev/null 2>&1; then
    warn "Cannot reach Katab server at ${SERVER_IP}"
    warn "Make sure the central server is running: ./setup.sh start"
    warn "Continuing with manual configuration..."

    KCD_URL="http://${SERVER_IP}/api/v1"
    KCP_URL="http://${SERVER_IP}:4100/api"
    RUNNER_TOKEN=""
  fi
fi

# Determine the correct KCD URL (port 80 via nginx or 4000 direct)
if curl -sf "http://${SERVER_IP}/api/v1" >/dev/null 2>&1; then
  KCD_URL="http://${SERVER_IP}/api/v1"
elif curl -sf "http://${SERVER_IP}:4000/api/v1" >/dev/null 2>&1; then
  KCD_URL="http://${SERVER_IP}:4000/api/v1"
else
  KCD_URL="http://${SERVER_IP}/api/v1"
fi
KCP_URL="http://${SERVER_IP}:4100/api"

# Try to auto-register as a runner via KCD API
RUNNER_TOKEN=""
if [ -n "$KCD_URL" ]; then
  # First, sign in to get a token
  AUTH_RESPONSE=$(curl -sf -X POST "${KCD_URL}/auth/sign-in" \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@katab.io","password":"password123"}' 2>/dev/null || echo "")

  if [ -n "$AUTH_RESPONSE" ]; then
    AUTH_TOKEN=$(echo "$AUTH_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

    if [ -n "$AUTH_TOKEN" ]; then
      # Create a runner registration
      RUNNER_RESPONSE=$(curl -sf -X POST "${KCD_URL}/account/runners" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -d "{\"name\":\"${NODE_NAME}\",\"platform\":\"$(echo $PLATFORMS | cut -d, -f1)\"}" 2>/dev/null || echo "")

      if [ -n "$RUNNER_RESPONSE" ]; then
        RUNNER_TOKEN=$(echo "$RUNNER_RESPONSE" | grep -o '"apiToken":"[^"]*"' | cut -d'"' -f4)
        if [ -n "$RUNNER_TOKEN" ]; then
          log "Runner registered successfully: ${NODE_NAME}"
        fi
      fi
    fi
  fi
fi

if [ -z "$RUNNER_TOKEN" ]; then
  warn "Auto-registration skipped. You'll need to create a runner in the Dashboard"
  warn "and paste the API token into .env (RUNNER_API_TOKEN=ktr_...)"
fi

# ─── Generate .env ───────────────────────────────────────
log "Writing configuration to .env..."

cat > "$KRC_DIR/.env" << ENVEOF
# ─── Katab Runner Console (KRC) Configuration ───
# Generated on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Server: ${SERVER_IP}

# Cloud Dashboard (KCD) connection
CLOUD_API_URL=${KCD_URL}
RUNNER_API_TOKEN=${RUNNER_TOKEN}

# Control Plane (KCP) connection
CONTROL_PLANE_URL=${KCP_URL}
NODE_API_TOKEN=
# NODE_API_TOKEN is auto-populated on first registration with KCP

# Runner identity
NODE_NAME=${NODE_NAME}
RUNNER_PLATFORMS=${PLATFORMS}

# Local API
LOCAL_API_PORT=${PORT}
LOCAL_API_BIND=0.0.0.0

# Retention (days)
REPORT_RETENTION_DAYS=7
LOG_RETENTION_DAYS=14
ENVEOF

log ".env written"
echo ""

# ─── Create systemd service or launchd plist ────────────
create_launch_script() {
  cat > "$KRC_DIR/start.sh" << 'STARTEOF'
#!/usr/bin/env bash
# Katab KRC — Start Script
cd "$(dirname "$0")"
echo "[KRC] Starting Katab Node Agent..."
exec npx ts-node-dev --respawn --transpile-only src/main.ts
STARTEOF
  chmod +x "$KRC_DIR/start.sh"

  cat > "$KRC_DIR/stop.sh" << 'STOPEOF'
#!/usr/bin/env bash
# Katab KRC — Stop Script
PID_FILE="$(dirname "$0")/.krc.pid"
if [ -f "$PID_FILE" ]; then
  kill "$(cat "$PID_FILE")" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "[KRC] Stopped."
else
  # Kill by port
  PID=$(lsof -ti:${LOCAL_API_PORT:-5001} 2>/dev/null || true)
  if [ -n "$PID" ]; then
    kill "$PID" 2>/dev/null || true
    echo "[KRC] Stopped (PID $PID)."
  else
    echo "[KRC] Not running."
  fi
fi
STOPEOF
  chmod +x "$KRC_DIR/stop.sh"

  cat > "$KRC_DIR/run-background.sh" << 'BGEOF'
#!/usr/bin/env bash
# Katab KRC — Run in Background
cd "$(dirname "$0")"
mkdir -p logs

# Kill existing
./stop.sh 2>/dev/null

echo "[KRC] Starting in background..."
nohup npx ts-node-dev --respawn --transpile-only src/main.ts > logs/krc.log 2>&1 &
echo $! > .krc.pid
echo "[KRC] Started (PID $(cat .krc.pid))"
echo "[KRC] Log: $(pwd)/logs/krc.log"
echo "[KRC] Dashboard: http://localhost:${LOCAL_API_PORT:-5001}"
BGEOF
  chmod +x "$KRC_DIR/run-background.sh"
}
create_launch_script

# ─── macOS launchd (optional) ────────────────────────────
create_launchd() {
  if [ "$(uname)" != "Darwin" ]; then return; fi

  local plist_dir="$HOME/Library/LaunchAgents"
  local plist_path="$plist_dir/io.katab.krc.plist"
  mkdir -p "$plist_dir"

  cat > "$plist_path" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>io.katab.krc</string>
  <key>ProgramArguments</key>
  <array>
    <string>${KRC_DIR}/start.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${KRC_DIR}</string>
  <key>RunAtLoad</key>
  <false/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${KRC_DIR}/logs/krc.log</string>
  <key>StandardErrorPath</key>
  <string>${KRC_DIR}/logs/krc.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>
</dict>
</plist>
PLISTEOF

  log "macOS LaunchAgent created: $plist_path"
}
create_launchd

# ─── Summary ─────────────────────────────────────────────
echo ""
sep
echo -e "${CYAN}${BOLD}  Katab KRC — Setup Complete${NC}"
sep
echo ""
echo -e "  ${BOLD}Node Name:${NC}   ${NODE_NAME}"
echo -e "  ${BOLD}Platforms:${NC}   ${PLATFORMS}"
echo -e "  ${BOLD}Server:${NC}      ${SERVER_IP}"
echo -e "  ${BOLD}Directory:${NC}   ${KRC_DIR}"
echo ""
sep
echo ""
echo -e "  ${BOLD}Start Commands:${NC}"
echo ""
echo -e "    ${GREEN}./start.sh${NC}              Start in foreground (Ctrl+C to stop)"
echo -e "    ${GREEN}./run-background.sh${NC}     Start in background"
echo -e "    ${GREEN}./stop.sh${NC}               Stop background process"
echo ""

if [ "$(uname)" = "Darwin" ]; then
  echo -e "  ${BOLD}macOS Auto-Start:${NC}"
  echo ""
  echo -e "    ${CYAN}launchctl load ~/Library/LaunchAgents/io.katab.krc.plist${NC}"
  echo -e "    ${DIM}(To disable: launchctl unload ~/Library/LaunchAgents/io.katab.krc.plist)${NC}"
  echo ""
fi

echo -e "  ${BOLD}Dashboard:${NC}"
echo -e "    ${GREEN}http://localhost:${PORT}${NC}   (KRC local dashboard)"
echo ""

if [ -z "$RUNNER_TOKEN" ]; then
  echo -e "  ${YELLOW}${BOLD}Action Required:${NC}"
  echo -e "    1. Open Dashboard: http://${SERVER_IP}"
  echo -e "    2. Go to Settings > Runners > Create Runner"
  echo -e "    3. Copy the API token (ktr_...)"
  echo -e "    4. Paste into ${KRC_DIR}/.env → RUNNER_API_TOKEN=ktr_..."
  echo ""
fi

sep
echo ""
log "Run ${BOLD}./start.sh${NC} to start the node agent."
echo ""
