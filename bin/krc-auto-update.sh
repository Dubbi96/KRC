#!/bin/bash
# krc-auto-update.sh — Periodic auto-update for KRC
# Called by launchd every hour. Checks for new commits, pulls, rebuilds, restarts.
set -euo pipefail

KRC_HOME="${KRC_HOME:-$HOME/Katab/KRC}"
LOG_DIR="$KRC_HOME/logs"
LOG_FILE="$LOG_DIR/auto-update.log"
LOCK_FILE="$LOG_DIR/auto-update.lock"

mkdir -p "$LOG_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

# Prevent concurrent runs
if [ -f "$LOCK_FILE" ]; then
  lock_pid=$(cat "$LOCK_FILE" 2>/dev/null)
  if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
    log "SKIP: Another update is running (PID: $lock_pid)"
    exit 0
  fi
  rm -f "$LOCK_FILE"
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

cd "$KRC_HOME"

# Fetch latest
git fetch origin main --quiet 2>>$LOG_FILE

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  log "OK: Up to date (${LOCAL:0:7})"
  exit 0
fi

BEHIND=$(git rev-list --count HEAD..origin/main)
log "UPDATE: ${BEHIND} new commit(s) — ${LOCAL:0:7} → ${REMOTE:0:7}"

# Log the changes
git log --oneline "$LOCAL..$REMOTE" >> "$LOG_FILE"

# Pull
if ! git pull origin main --ff-only >> "$LOG_FILE" 2>&1; then
  log "ERROR: git pull failed (possible local changes). Attempting reset..."
  git stash >> "$LOG_FILE" 2>&1 || true
  git pull origin main --ff-only >> "$LOG_FILE" 2>&1 || {
    log "ERROR: git pull still failed. Manual intervention needed."
    exit 1
  }
fi

# Install dependencies
log "Installing dependencies..."
npm install >> "$LOG_FILE" 2>&1

# Build KRC
log "Building KRC..."
npm run build >> "$LOG_FILE" 2>&1

# Build recorder
log "Building recorder..."
(cd packages/recorder && npm install && npm run build) >> "$LOG_FILE" 2>&1

# Install Playwright browsers (only chromium to save space)
npx playwright install chromium >> "$LOG_FILE" 2>&1 || true

# Restart KRC if it's currently running
LAUNCHD_LABEL="com.katab.krc"
if launchctl list "$LAUNCHD_LABEL" &>/dev/null; then
  log "Restarting KRC..."
  launchctl stop "$LAUNCHD_LABEL" 2>/dev/null || true
  sleep 2
  launchctl start "$LAUNCHD_LABEL" 2>/dev/null || true
  log "KRC restarted"
elif [ -f "$LOG_DIR/krc.pid" ]; then
  pid=$(cat "$LOG_DIR/krc.pid")
  if kill -0 "$pid" 2>/dev/null; then
    log "Restarting KRC (PID: $pid)..."
    kill "$pid" 2>/dev/null || true
    sleep 2
    cd "$KRC_HOME"
    nohup node dist/main.js >> "$LOG_DIR/krc.log" 2>&1 &
    echo $! > "$LOG_DIR/krc.pid"
    log "KRC restarted (new PID: $!)"
  fi
fi

log "UPDATE COMPLETE: Now at $(git rev-parse --short HEAD)"

# Trim log file to last 1000 lines
tail -1000 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
