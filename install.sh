#!/bin/bash
# ─── Katab Runner Console (KRC) Installer for macOS ───
# Usage: curl -sSL https://raw.githubusercontent.com/Dubbi96/KRC/main/install.sh | bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

KRC_HOME="${KRC_HOME:-$HOME/Katab/KRC}"
KRC_REPO="https://github.com/Dubbi96/KRC.git"
PLIST_DIR="$HOME/Library/LaunchAgents"

echo -e "${CYAN}"
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║   Katab Runner Console — macOS Installer  ║"
echo "  ╚═══════════════════════════════════════════╝"
echo -e "${NC}"

# ─── Step 1: Prerequisites ───
echo -e "${CYAN}[1/7] Checking prerequisites...${NC}"

# Check macOS
if [[ "$(uname)" != "Darwin" ]]; then
  echo -e "${RED}This installer is for macOS only.${NC}"
  exit 1
fi

# Check Xcode CLI tools
if ! xcode-select -p &>/dev/null; then
  echo -e "${YELLOW}Installing Xcode Command Line Tools...${NC}"
  xcode-select --install
  echo -e "${YELLOW}Please complete the Xcode CLI installation and re-run this script.${NC}"
  exit 1
fi

# Check Node.js
if ! command -v node &>/dev/null; then
  echo -e "${YELLOW}Node.js not found. Installing via Homebrew...${NC}"
  if ! command -v brew &>/dev/null; then
    echo -e "${RED}Homebrew required. Install from https://brew.sh${NC}"
    exit 1
  fi
  brew install node@20
  echo 'export PATH="/opt/homebrew/opt/node@20/bin:$PATH"' >> ~/.zshrc
  export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo -e "${RED}Node.js 20+ required (current: $(node -v))${NC}"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} Node.js $(node -v)"

# Check git
if ! command -v git &>/dev/null; then
  echo -e "${RED}git not found. Install Xcode CLI tools.${NC}"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} git $(git --version | awk '{print $3}')"

# Detect node path for launchd
NODE_PATH=$(which node)
echo -e "  ${GREEN}✓${NC} Node path: $NODE_PATH"

# ─── Step 2: Clone or Update ───
echo -e "\n${CYAN}[2/7] Setting up KRC...${NC}"

if [ -d "$KRC_HOME/.git" ]; then
  echo -e "  ${YELLOW}KRC already exists at $KRC_HOME — pulling latest...${NC}"
  cd "$KRC_HOME"
  git pull origin main --ff-only
else
  echo -e "  Cloning KRC to $KRC_HOME..."
  mkdir -p "$(dirname "$KRC_HOME")"
  git clone "$KRC_REPO" "$KRC_HOME"
  cd "$KRC_HOME"
fi

echo -e "  ${GREEN}✓${NC} KRC source ready ($(git rev-parse --short HEAD))"

# ─── Step 3: Install Dependencies ───
echo -e "\n${CYAN}[3/7] Installing dependencies...${NC}"

cd "$KRC_HOME"
npm install --production
echo -e "  ${GREEN}✓${NC} Root dependencies installed"

cd "$KRC_HOME/packages/recorder"
npm install --production
echo -e "  ${GREEN}✓${NC} Recorder dependencies installed"

# ─── Step 4: Build ───
echo -e "\n${CYAN}[4/7] Building...${NC}"

cd "$KRC_HOME"
npm run build
echo -e "  ${GREEN}✓${NC} KRC built"

cd "$KRC_HOME/packages/recorder"
npm run build
echo -e "  ${GREEN}✓${NC} Recorder built"

# Install Playwright browsers
cd "$KRC_HOME"
npx playwright install chromium 2>/dev/null || true
echo -e "  ${GREEN}✓${NC} Playwright browsers installed"

# ─── Step 5: Configuration ───
echo -e "\n${CYAN}[5/7] Configuration...${NC}"

if [ ! -f "$KRC_HOME/.env" ]; then
  cp "$KRC_HOME/.env.example" "$KRC_HOME/.env"
  echo -e "  ${YELLOW}Created .env from template — you MUST edit it before starting:${NC}"
  echo -e "  ${YELLOW}  krc config${NC}"
  echo ""
  echo -e "  Required settings:"
  echo -e "    ${CYAN}RUNNER_API_TOKEN${NC}  — Get from KCD Dashboard > Runners"
  echo -e "    ${CYAN}NODE_API_TOKEN${NC}    — Auto-assigned on first KCP registration"
  echo -e "    ${CYAN}RUNNER_PLATFORMS${NC}  — web, ios, android (comma-separated)"
  echo -e "    ${CYAN}NODE_NAME${NC}         — Unique name for this runner"
  NEEDS_CONFIG=true
else
  echo -e "  ${GREEN}✓${NC} .env already exists (preserved)"
  NEEDS_CONFIG=false
fi

# Create logs directory
mkdir -p "$KRC_HOME/logs"

# ─── Step 6: Install CLI ───
echo -e "\n${CYAN}[6/7] Installing krc CLI...${NC}"

chmod +x "$KRC_HOME/bin/krc"
chmod +x "$KRC_HOME/bin/krc-auto-update.sh"

# Symlink to /usr/local/bin
if [ -w /usr/local/bin ] || sudo -n true 2>/dev/null; then
  sudo ln -sf "$KRC_HOME/bin/krc" /usr/local/bin/krc
  echo -e "  ${GREEN}✓${NC} krc command installed to /usr/local/bin/krc"
else
  echo -e "  ${YELLOW}Need sudo to install krc to /usr/local/bin${NC}"
  sudo ln -sf "$KRC_HOME/bin/krc" /usr/local/bin/krc
  echo -e "  ${GREEN}✓${NC} krc command installed"
fi

# ─── Step 7: Register Services ───
echo -e "\n${CYAN}[7/7] Registering macOS services...${NC}"

mkdir -p "$PLIST_DIR"
USER_HOME="$HOME"
CURRENT_USER="$(whoami)"

# KRC main service
KRC_PLIST="$PLIST_DIR/com.katab.krc.plist"
cp "$KRC_HOME/launchd/com.katab.krc.plist" "$KRC_PLIST"
sed -i '' "s|__KRC_HOME__|$KRC_HOME|g" "$KRC_PLIST"
sed -i '' "s|__USER_HOME__|$USER_HOME|g" "$KRC_PLIST"
sed -i '' "s|__USER__|$CURRENT_USER|g" "$KRC_PLIST"
sed -i '' "s|/usr/local/bin/node|$NODE_PATH|g" "$KRC_PLIST"
echo -e "  ${GREEN}✓${NC} KRC service registered (auto-start on login)"

# Auto-updater service
UPDATER_PLIST="$PLIST_DIR/com.katab.krc-updater.plist"
cp "$KRC_HOME/launchd/com.katab.krc-updater.plist" "$UPDATER_PLIST"
sed -i '' "s|__KRC_HOME__|$KRC_HOME|g" "$UPDATER_PLIST"
sed -i '' "s|__USER_HOME__|$USER_HOME|g" "$UPDATER_PLIST"
sed -i '' "s|__USER__|$CURRENT_USER|g" "$UPDATER_PLIST"
echo -e "  ${GREEN}✓${NC} Auto-updater registered (hourly check)"

# Load services (don't start yet if config needed)
launchctl load "$UPDATER_PLIST" 2>/dev/null || true

if [ "$NEEDS_CONFIG" = true ]; then
  echo ""
  echo -e "${YELLOW}═══════════════════════════════════════════════${NC}"
  echo -e "${YELLOW}  Setup almost complete!${NC}"
  echo -e "${YELLOW}  Edit .env configuration before starting:${NC}"
  echo ""
  echo -e "    ${CYAN}krc config${NC}     # Edit .env"
  echo -e "    ${CYAN}krc start${NC}      # Start KRC"
  echo -e "    ${CYAN}krc status${NC}     # Check status"
  echo -e "${YELLOW}═══════════════════════════════════════════════${NC}"
else
  # Start KRC if config exists
  launchctl load "$KRC_PLIST" 2>/dev/null || true
  launchctl start com.katab.krc 2>/dev/null || true
  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  KRC installed and started!${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
fi

echo ""
echo -e "  ${CYAN}Commands:${NC}"
echo -e "    krc start      Start KRC"
echo -e "    krc stop       Stop KRC"
echo -e "    krc status     Check status & version"
echo -e "    krc update     Manual update"
echo -e "    krc logs       View logs"
echo -e "    krc config     Edit configuration"
echo -e "    krc help       All commands"
echo ""
echo -e "  ${CYAN}Auto-update:${NC} Enabled (checks every hour)"
echo -e "  ${CYAN}Auto-start:${NC}  Enabled (starts on login)"
echo -e "  ${CYAN}Install dir:${NC} $KRC_HOME"
echo ""
