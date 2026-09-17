#!/usr/bin/env bash
set -u
APP_DIR="${APP_DIR:-/home/hallaym/masofaviy}"
APP_PORT="${APP_PORT:-10000}"
SFU_PORT="${SFU_PORT:-3010}"
WEB_DOMAIN="${WEB_DOMAIN:-edu.hallaym.com}"
RTC_DOMAIN="${RTC_DOMAIN:-rtc.hallaym.com}"
PASS=0; FAIL=0; WARN=0
ok(){ echo "PASS  $*"; PASS=$((PASS+1)); }
bad(){ echo "FAIL  $*"; FAIL=$((FAIL+1)); }
warn(){ echo "WARN  $*"; WARN=$((WARN+1)); }
check_service(){ systemctl is-active --quiet "$1" && ok "$1 active" || bad "$1 inactive"; systemctl is-enabled --quiet "$1" && ok "$1 enabled" || warn "$1 not enabled"; }
check_port(){ ss -lntup 2>/dev/null | grep -qE "$1" && ok "port $1 listening" || bad "port $1 not listening"; }

echo "=== QDTU production acceptance ==="
cd "$APP_DIR" 2>/dev/null || { bad "repo missing: $APP_DIR"; exit 1; }

git diff --quiet && git diff --cached --quiet && ok "git working tree clean" || warn "git working tree has local changes"
node --check server-v2.js >/dev/null 2>&1 && ok "server-v2.js syntax" || bad "server-v2.js syntax"
for f in rtc-session-runtime.js lesson-status-runtime.js compliance-runtime.js recording-runtime.js; do
  node --check "$f" >/dev/null 2>&1 && ok "$f syntax" || bad "$f syntax"
done
for f in public/core-v2.js public/v5-classroom.js public/assessment-v5.js public/recording-v5.js public/compliance-v5.js; do
  [ -f "$f" ] || { bad "$f missing"; continue; }
  node --check "$f" >/dev/null 2>&1 && ok "$f syntax" || bad "$f syntax"
done

check_service masofaviy.service
check_service qdtusfu.service
systemctl is-active --quiet nginx && ok "nginx active" || bad "nginx inactive"

check_port ":$APP_PORT\\b"
check_port ":$SFU_PORT\\b"
check_port ":40000\\b"
check_port ":40001\\b"

WEB_HEALTH="$(curl -fsS --max-time 4 http://127.0.0.1:$APP_PORT/health 2>/dev/null || true)"
[ -n "$WEB_HEALTH" ] && ok "main /health responds" || bad "main /health unavailable"
echo "$WEB_HEALTH" | grep -q '"db":"connected"' && ok "MongoDB connected" || bad "MongoDB not connected"

SFU_HEALTH="$(curl -fsS --max-time 4 http://127.0.0.1:$SFU_PORT/health 2>/dev/null || true)"
[ -n "$SFU_HEALTH" ] && ok "SFU /health responds" || bad "SFU /health unavailable"
echo "$SFU_HEALTH" | grep -q '"ok":true' && ok "SFU health ok" || bad "SFU health not ok"

curl -fsS --max-time 4 -H "Host: $WEB_DOMAIN" http://127.0.0.1/health >/dev/null 2>&1 && ok "Nginx main proxy" || bad "Nginx main proxy"
curl -fsS --max-time 4 -H "Host: $RTC_DOMAIN" http://127.0.0.1/health >/dev/null 2>&1 && ok "Nginx RTC proxy" || bad "Nginx RTC proxy"

[ -f "/etc/letsencrypt/live/$WEB_DOMAIN/fullchain.pem" ] && ok "$WEB_DOMAIN certificate exists" || warn "$WEB_DOMAIN certificate missing"
[ -f "/etc/letsencrypt/live/$RTC_DOMAIN/fullchain.pem" ] && ok "$RTC_DOMAIN certificate exists" || warn "$RTC_DOMAIN certificate missing"

if [ -f .env ]; then
  grep -q '^MONGODB_URI=.' .env && ok "MONGODB_URI configured" || bad "MONGODB_URI missing"
  grep -q '^RTC_BRIDGE_URL=https://' .env && ok "RTC_BRIDGE_URL configured" || bad "RTC_BRIDGE_URL missing/invalid"
  grep -q '^RTC_TOKEN_SECRET=.' .env && ok "RTC token secret configured" || bad "RTC token secret missing"
  grep -q '^TURN_URLS=.' .env && ok "TURN configured in web app" || warn "TURN_URLS not configured"
else
  bad ".env missing"
fi

if [ -f sfu/.env ] && [ -f .env ]; then
  MAIN_SECRET="$(grep '^RTC_TOKEN_SECRET=' .env | head -1 | cut -d= -f2-)"
  SFU_SECRET="$(grep '^RTC_TOKEN_SECRET=' sfu/.env | head -1 | cut -d= -f2-)"
  [ -n "$MAIN_SECRET" ] && [ "$MAIN_SECRET" = "$SFU_SECRET" ] && ok "RTC secrets synchronized" || bad "RTC secrets mismatch"
fi

if systemctl list-unit-files coturn.service >/dev/null 2>&1; then
  systemctl is-active --quiet coturn && ok "coturn active" || warn "coturn installed but inactive"
else
  warn "coturn service not found"
fi

echo
echo "PASS=$PASS FAIL=$FAIL WARN=$WARN"
if [ "$FAIL" -gt 0 ]; then
  echo "RESULT=FAILED"
  exit 1
fi
echo "RESULT=PASS_LOCAL"
echo "NOTE: public NAT/HTTPS and real two-device WebRTC still require an external phone/PC test."
