#!/bin/bash
# krc-setup.sh — Interactive setup: create runner in KCD, write .env
set -euo pipefail

KRC_HOME="${KRC_HOME:-$HOME/Katab/KRC}"
KCD_URL="${KCD_URL:-http://katab-prod-kcd-alb-1334992113.ap-northeast-2.elb.amazonaws.com}"
KCP_URL="${KCP_URL:-http://katab-prod-kcp-alb-2032050242.ap-northeast-2.elb.amazonaws.com/api}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║   Katab Runner Console — Setup            ║"
echo "  ╚═══════════════════════════════════════════╝"
echo -e "${NC}"

# ─── Collect credentials ───
echo -e "${CYAN}KCD Dashboard 로그인 정보를 입력하세요:${NC}"
echo ""

if [ -n "${KCD_EMAIL:-}" ]; then
  EMAIL="$KCD_EMAIL"
  echo -e "  Email: $EMAIL (from env)"
else
  printf "  Email: "
  read -r EMAIL
fi

if [ -n "${KCD_PASSWORD:-}" ]; then
  PASSWORD="$KCD_PASSWORD"
  echo "  Password: ******* (from env)"
else
  printf "  Password: "
  read -rs PASSWORD
  echo ""
fi

echo ""

# Runner settings
DEFAULT_NAME=$(hostname | sed 's/\.local$//')
printf "  Runner 이름 [${DEFAULT_NAME}]: "
read -r RUNNER_NAME
RUNNER_NAME="${RUNNER_NAME:-$DEFAULT_NAME}"

# Auto-detect connected devices to suggest platforms
AUTO_PLATFORMS="web"
if command -v adb &>/dev/null && adb devices 2>/dev/null | grep -qE '^\S+\s+device'; then
  AUTO_PLATFORMS="web,android"
fi
if command -v xcrun &>/dev/null; then
  TMPFILE=$(mktemp /tmp/katab-setup-XXXXXX.json)
  if xcrun devicectl list devices --json-output "$TMPFILE" 2>/dev/null; then
    if python3 -c "import json; d=json.load(open('$TMPFILE')); exit(0 if any(x.get('hardwareProperties',{}).get('platform')=='iOS' and x.get('hardwareProperties',{}).get('reality')=='physical' for x in d.get('result',{}).get('devices',[])) else 1)" 2>/dev/null; then
      AUTO_PLATFORMS="${AUTO_PLATFORMS},ios"
    fi
  fi
  rm -f "$TMPFILE"
fi

printf "  플랫폼 (web,ios,android) [${AUTO_PLATFORMS}]: "
read -r PLATFORMS
PLATFORMS="${PLATFORMS:-$AUTO_PLATFORMS}"

# Warn about missing dependencies
if echo "$PLATFORMS" | grep -q "android"; then
  if ! command -v adb &>/dev/null; then
    echo -e "  ${YELLOW}⚠ Android selected but 'adb' not found.${NC}"
    echo -e "    Install: brew install --cask android-platform-tools"
  fi
  if ! command -v java &>/dev/null; then
    echo -e "  ${YELLOW}⚠ Android selected but 'java' not found.${NC}"
    echo -e "    Install: brew install openjdk@17"
  fi
fi

echo ""

# ─── Sign in to KCD ───
echo -e "${CYAN}KCD 로그인 중...${NC}"

LOGIN_RESPONSE=$(python3 -c "
import json, urllib.request, sys
data = json.dumps({'email': '$EMAIL', 'password': '$PASSWORD'}).encode()
req = urllib.request.Request('${KCD_URL}/api/v1/auth/sign-in', data=data, headers={'Content-Type': 'application/json'})
try:
    resp = urllib.request.urlopen(req)
    print(resp.read().decode())
except urllib.error.HTTPError as e:
    print(json.dumps({'error': e.read().decode()}), file=sys.stderr)
    sys.exit(1)
" 2>&1)

if echo "$LOGIN_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if 'token' in d else 1)" 2>/dev/null; then
  JWT=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
  TENANT_ID=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['tenant']['id'])")
  TENANT_NAME=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['tenant']['name'])")
  echo -e "  ${GREEN}✓${NC} 로그인 성공 (tenant: ${TENANT_NAME})"
else
  echo -e "  ${RED}✗ 로그인 실패${NC}"
  echo "  $LOGIN_RESPONSE"
  exit 1
fi

# ─── Create runner for each platform ───
# Split platforms and create one runner per platform (KCD routes jobs by runner platform)
IFS=',' read -ra PLATFORM_LIST <<< "$PLATFORMS"

RUNNER_TOKENS=()
RUNNER_IDS=()

for PLATFORM in "${PLATFORM_LIST[@]}"; do
  PLATFORM=$(echo "$PLATFORM" | xargs)  # trim whitespace
  RUNNER_FULL_NAME="${RUNNER_NAME}-${PLATFORM}"

  echo -e "${CYAN}Runner 생성 중: ${RUNNER_FULL_NAME} (${PLATFORM})...${NC}"

  CREATE_RESPONSE=$(python3 -c "
import json, urllib.request, sys
data = json.dumps({'name': '$RUNNER_FULL_NAME', 'platform': '$PLATFORM'}).encode()
req = urllib.request.Request('${KCD_URL}/api/v1/account/runners', data=data,
  headers={'Content-Type': 'application/json', 'Authorization': 'Bearer $JWT'})
try:
    resp = urllib.request.urlopen(req)
    print(resp.read().decode())
except urllib.error.HTTPError as e:
    body = e.read().decode()
    print(json.dumps({'error': body}), file=sys.stderr)
    sys.exit(1)
" 2>&1)

  if echo "$CREATE_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if 'apiToken' in d else 1)" 2>/dev/null; then
    API_TOKEN=$(echo "$CREATE_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['apiToken'])")
    RUNNER_ID=$(echo "$CREATE_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
    RUNNER_TOKENS+=("$API_TOKEN")
    RUNNER_IDS+=("$RUNNER_ID")
    echo -e "  ${GREEN}✓${NC} Runner 생성 완료: ${RUNNER_FULL_NAME}"
    echo -e "    ID:    ${RUNNER_ID}"
    echo -e "    Token: ${API_TOKEN:0:20}..."
  else
    echo -e "  ${RED}✗ Runner 생성 실패${NC}"
    echo "  $CREATE_RESPONSE"
    exit 1
  fi
done

# Use the first runner's token as the primary (KRC sends heartbeat with this token)
PRIMARY_TOKEN="${RUNNER_TOKENS[0]}"
PRIMARY_RUNNER_ID="${RUNNER_IDS[0]}"

echo ""

# ─── Write .env ───
echo -e "${CYAN}.env 설정 파일 작성 중...${NC}"

ENV_FILE="$KRC_HOME/.env"

cat > "$ENV_FILE" << ENVEOF
# ─── Katab Runner Console (KRC) Configuration ───
# Auto-generated by krc setup at $(date '+%Y-%m-%d %H:%M:%S')

# Cloud Dashboard (KCD)
CLOUD_API_URL=${KCD_URL}/api/v1
RUNNER_API_TOKEN=${PRIMARY_TOKEN}

# Control Plane (KCP) — NODE_API_TOKEN is auto-set on first boot
CONTROL_PLANE_URL=${KCP_URL}
NODE_API_TOKEN=

# Runner identity
NODE_NAME=${RUNNER_NAME}
RUNNER_PLATFORMS=${PLATFORMS}
RUNNER_ID=${PRIMARY_RUNNER_ID}
TENANT_ID=${TENANT_ID}

# Local API
LOCAL_API_PORT=5001
LOCAL_API_BIND=0.0.0.0
ENVEOF

echo -e "  ${GREEN}✓${NC} .env 작성 완료: $ENV_FILE"

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Setup 완료!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
echo ""
echo -e "  Runner:    ${RUNNER_NAME}"
echo -e "  Platforms: ${PLATFORMS}"
echo -e "  Tenant:    ${TENANT_NAME}"
echo ""
echo -e "  ${CYAN}krc start${NC} 로 KRC를 시작하세요."
echo ""
