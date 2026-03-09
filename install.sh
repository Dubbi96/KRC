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
  # node@20 is keg-only — add to PATH for both Intel and Apple Silicon Macs
  if [ -d "/usr/local/opt/node@20/bin" ]; then
    export PATH="/usr/local/opt/node@20/bin:$PATH"
    grep -q 'node@20' ~/.zshrc 2>/dev/null || echo 'export PATH="/usr/local/opt/node@20/bin:$PATH"' >> ~/.zshrc
  elif [ -d "/opt/homebrew/opt/node@20/bin" ]; then
    export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
    grep -q 'node@20' ~/.zshrc 2>/dev/null || echo 'export PATH="/opt/homebrew/opt/node@20/bin:$PATH"' >> ~/.zshrc
  fi
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
npm install
echo -e "  ${GREEN}✓${NC} Root dependencies installed"

cd "$KRC_HOME/packages/recorder"
npm install
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

# ─── Android dependencies (when RUNNER_PLATFORMS includes android) ───
cd "$KRC_HOME"
RUNNER_PLATFORMS=""
if [ -f "$KRC_HOME/.env" ]; then
  RUNNER_PLATFORMS=$(grep '^RUNNER_PLATFORMS=' "$KRC_HOME/.env" 2>/dev/null | cut -d'=' -f2 || true)
fi

if echo "$RUNNER_PLATFORMS" | grep -q "android"; then
  echo -e "\n${CYAN}[4.1] Installing Android dependencies...${NC}"

  if ! command -v adb &>/dev/null; then
    echo -e "  Installing android-platform-tools (adb)..."
    brew install --cask android-platform-tools
  fi
  echo -e "  ${GREEN}✓${NC} adb $(adb version 2>/dev/null | head -1 | awk '{print $NF}' || echo 'installed')"

  if ! command -v appium &>/dev/null; then
    echo -e "  Installing Appium..."
    npm install -g appium
  fi
  echo -e "  ${GREEN}✓${NC} Appium $(appium --version 2>/dev/null || echo 'installed')"

  if ! appium driver list 2>/dev/null | grep -q "uiautomator2.*installed"; then
    echo -e "  Installing Appium UiAutomator2 driver..."
    appium driver install uiautomator2
  fi
  echo -e "  ${GREEN}✓${NC} UiAutomator2 driver"

  if ! command -v java &>/dev/null; then
    echo -e "  Installing OpenJDK 17..."
    brew install openjdk@17
    # Symlink for system Java wrappers to find it
    if [ -d "/usr/local/opt/openjdk@17" ]; then
      sudo ln -sfn /usr/local/opt/openjdk@17/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk-17.jdk 2>/dev/null || true
    elif [ -d "/opt/homebrew/opt/openjdk@17" ]; then
      sudo ln -sfn /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk-17.jdk 2>/dev/null || true
    fi
  fi
  echo -e "  ${GREEN}✓${NC} Java $(java -version 2>&1 | head -1 || echo 'installed')"

  # Android SDK (cmdline-tools)
  if [ -z "${ANDROID_HOME:-}" ] && [ ! -d "$HOME/Library/Android/sdk" ]; then
    echo -e "  Installing Android SDK command-line tools..."
    brew install --cask android-commandlinetools
    # Determine ANDROID_HOME
    if [ -d "/usr/local/share/android-commandlinetools" ]; then
      export ANDROID_HOME=/usr/local/share/android-commandlinetools
    elif [ -d "/opt/homebrew/share/android-commandlinetools" ]; then
      export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
    fi
    # Determine JAVA_HOME
    if [ -d "/usr/local/opt/openjdk@17" ]; then
      export JAVA_HOME=/usr/local/opt/openjdk@17
    elif [ -d "/opt/homebrew/opt/openjdk@17" ]; then
      export JAVA_HOME=/opt/homebrew/opt/openjdk@17
    fi
    yes | sdkmanager --sdk_root="$ANDROID_HOME" "platform-tools" "build-tools;34.0.0" "platforms;android-34" 2>/dev/null || true
  fi
  echo -e "  ${GREEN}✓${NC} Android SDK"
fi

# ─── iOS dependencies (when RUNNER_PLATFORMS includes ios) ───
if echo "$RUNNER_PLATFORMS" | grep -q "ios"; then
  echo -e "\n${CYAN}[4.2] Installing iOS dependencies...${NC}"

  if ! command -v appium &>/dev/null; then
    echo -e "  Installing Appium..."
    npm install -g appium
  fi

  if ! appium driver list 2>/dev/null | grep -q "xcuitest.*installed"; then
    echo -e "  Installing Appium XCUITest driver..."
    appium driver install xcuitest
  fi
  echo -e "  ${GREEN}✓${NC} XCUITest driver"
fi

# ─── Step 5: Configuration ───
echo -e "\n${CYAN}[5/7] Configuration...${NC}"

if [ ! -f "$KRC_HOME/.env" ]; then
  echo -e "  ${CYAN}Runner 등록 및 .env 설정을 진행합니다.${NC}"
  echo ""
  KRC_HOME="$KRC_HOME" bash "$KRC_HOME/bin/krc-setup.sh"
  NEEDS_CONFIG=false
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

# Resolve JAVA_HOME and ANDROID_HOME for launchd (Appium needs these)
JAVA_HOME_VAL="${JAVA_HOME:-}"
if [ -z "$JAVA_HOME_VAL" ]; then
  # Auto-detect Java home
  if [ -d "/usr/local/opt/openjdk@17" ]; then
    JAVA_HOME_VAL="/usr/local/opt/openjdk@17"
  elif [ -d "/opt/homebrew/opt/openjdk@17" ]; then
    JAVA_HOME_VAL="/opt/homebrew/opt/openjdk@17"
  elif /usr/libexec/java_home &>/dev/null; then
    JAVA_HOME_VAL=$(/usr/libexec/java_home 2>/dev/null || true)
  fi
fi
ANDROID_HOME_VAL="${ANDROID_HOME:-}"
if [ -z "$ANDROID_HOME_VAL" ]; then
  if [ -d "$HOME/Library/Android/sdk" ]; then
    ANDROID_HOME_VAL="$HOME/Library/Android/sdk"
  elif [ -d "/usr/local/share/android-commandlinetools" ]; then
    ANDROID_HOME_VAL="/usr/local/share/android-commandlinetools"
  elif [ -d "/opt/homebrew/share/android-commandlinetools" ]; then
    ANDROID_HOME_VAL="/opt/homebrew/share/android-commandlinetools"
  fi
fi
sed -i '' "s|__JAVA_HOME__|${JAVA_HOME_VAL:-/usr/local/opt/openjdk@17}|g" "$KRC_PLIST"
sed -i '' "s|__ANDROID_HOME__|${ANDROID_HOME_VAL:-/usr/local/share/android-commandlinetools}|g" "$KRC_PLIST"

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

# Start KRC
launchctl load "$KRC_PLIST" 2>/dev/null || true
launchctl start com.katab.krc 2>/dev/null || true
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
echo -e "${GREEN}  KRC installed and started!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════${NC}"

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
