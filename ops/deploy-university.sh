#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/home/hallaym/masofaviy}"
APP_USER="${APP_USER:-hallaym}"
APP_PORT="${APP_PORT:-10000}"
WEB_DOMAIN="${WEB_DOMAIN:-edu.hallaym.com}"
RTC_DOMAIN="${RTC_DOMAIN:-rtc.hallaym.com}"
SFU_PORT="${SFU_PORT:-3010}"
ENV_FILE="$APP_DIR/.env"
SFU_ENV="$APP_DIR/sfu/.env"
RECORDINGS_DIR="${RECORDINGS_DIR:-$APP_DIR/storage/recordings}"

say(){ printf '\n[%s] %s\n' "$(date +'%H:%M:%S')" "$*"; }
fail(){ echo "FAILED: $*" >&2; exit 1; }
need(){ command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"; }

need git; need node; need npm; need curl; need python3; need sudo
cd "$APP_DIR" || fail "missing repo: $APP_DIR"

say "Repository holati"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "$APP_DIR git repo emas"
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "BLOCKED: repo ichida commit qilinmagan o'zgarishlar bor. Ularni yo'qotmaslik uchun deploy to'xtatildi."
  git status --short
  exit 2
fi

git fetch origin main
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/main)"
if [ "$LOCAL" != "$REMOTE" ]; then
  git pull --ff-only origin main
fi

say "Production .env tekshiruvi"
if [ ! -f "$ENV_FILE" ]; then
  cp .env.example "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

set_env(){
  local file="$1" key="$2" value="$3"
  FILE="$file" KEY="$key" VALUE="$value" python3 - <<'PY'
import os
from pathlib import Path
p=Path(os.environ['FILE']); key=os.environ['KEY']; value=os.environ['VALUE']
lines=p.read_text().splitlines() if p.exists() else []
out=[]; found=False
for line in lines:
    if line.startswith(key+'='):
        out.append(f'{key}={value}'); found=True
    else:
        out.append(line)
if not found: out.append(f'{key}={value}')
p.write_text('\n'.join(out)+'\n')
PY
}
get_env(){
  FILE="$1" KEY="$2" python3 - <<'PY'
import os
from pathlib import Path
p=Path(os.environ['FILE']); key=os.environ['KEY']+'='
if not p.exists(): raise SystemExit
for line in p.read_text().splitlines():
    if line.startswith(key):
        print(line[len(key):]); break
PY
}

set_env "$ENV_FILE" NODE_ENV production
set_env "$ENV_FILE" PORT "$APP_PORT"
set_env "$ENV_FILE" DB_NAME masofaviy
set_env "$ENV_FILE" RTC_BRIDGE_URL "https://$RTC_DOMAIN"
set_env "$ENV_FILE" RECORDINGS_DIR "$RECORDINGS_DIR"

JWT="$(get_env "$ENV_FILE" JWT_SECRET || true)"
if [ -z "$JWT" ] || [ "$JWT" = "change-this-to-a-long-random-secret" ]; then
  JWT="$(openssl rand -hex 48)"
  set_env "$ENV_FILE" JWT_SECRET "$JWT"
fi

MAIN_RTC="$(get_env "$ENV_FILE" RTC_TOKEN_SECRET || true)"
SFU_RTC="$(get_env "$SFU_ENV" RTC_TOKEN_SECRET 2>/dev/null || true)"
if [ -n "$SFU_RTC" ]; then
  set_env "$ENV_FILE" RTC_TOKEN_SECRET "$SFU_RTC"
elif [ -n "$MAIN_RTC" ]; then
  [ -f "$SFU_ENV" ] || fail "SFU env topilmadi: $SFU_ENV"
  set_env "$SFU_ENV" RTC_TOKEN_SECRET "$MAIN_RTC"
else
  NEW_RTC="$(openssl rand -hex 48)"
  set_env "$ENV_FILE" RTC_TOKEN_SECRET "$NEW_RTC"
  [ -f "$SFU_ENV" ] || fail "SFU env topilmadi: $SFU_ENV"
  set_env "$SFU_ENV" RTC_TOKEN_SECRET "$NEW_RTC"
fi
chmod 600 "$ENV_FILE" "$SFU_ENV" 2>/dev/null || true

MONGO="$(get_env "$ENV_FILE" MONGODB_URI || true)"
[ -n "$MONGO" ] || fail "MONGODB_URI bo'sh. .env ga Atlas URI yozilgandan keyin qayta ishga tushiring."

say "Node dependency va frontend RTC bundle"
npm install --omit=dev
npm run build:rtc
mkdir -p "$RECORDINGS_DIR"
sudo chown -R "$APP_USER:$APP_USER" "$RECORDINGS_DIR"
chmod 750 "$RECORDINGS_DIR"

say "Main web systemd service"
sudo tee /etc/systemd/system/masofaviy.service >/dev/null <<EOF
[Unit]
Description=QDTU Masofaviy Talim Main Web
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=3
TimeoutStopSec=20
KillSignal=SIGTERM
LimitNOFILE=65535
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable masofaviy.service >/dev/null
sudo systemctl restart masofaviy.service

say "SFU service"
if systemctl list-unit-files qdtusfu.service >/dev/null 2>&1; then
  sudo systemctl enable qdtusfu.service >/dev/null || true
  sudo systemctl restart qdtusfu.service
else
  fail "qdtusfu.service topilmadi"
fi

say "Nginx reverse proxy"
need nginx
WEB_CERT="/etc/letsencrypt/live/$WEB_DOMAIN/fullchain.pem"
WEB_KEY="/etc/letsencrypt/live/$WEB_DOMAIN/privkey.pem"
RTC_CERT="/etc/letsencrypt/live/$RTC_DOMAIN/fullchain.pem"
RTC_KEY="/etc/letsencrypt/live/$RTC_DOMAIN/privkey.pem"

write_http_site(){
  local name="$1" domain="$2" port="$3"
  sudo tee "/etc/nginx/sites-available/$name" >/dev/null <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $domain;
    client_max_body_size 20m;
    location / {
        proxy_pass http://127.0.0.1:$port;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
EOF
}

write_https_site(){
  local name="$1" domain="$2" port="$3" cert="$4" key="$5"
  sudo tee "/etc/nginx/sites-available/$name" >/dev/null <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $domain;
    return 301 https://\$host\$request_uri;
}
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $domain;
    ssl_certificate $cert;
    ssl_certificate_key $key;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 20m;
    location / {
        proxy_pass http://127.0.0.1:$port;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        proxy_buffering off;
    }
}
EOF
}

if sudo test -f "$WEB_CERT" && sudo test -f "$WEB_KEY"; then
  write_https_site qdtu-edu "$WEB_DOMAIN" "$APP_PORT" "$WEB_CERT" "$WEB_KEY"
else
  write_http_site qdtu-edu "$WEB_DOMAIN" "$APP_PORT"
  echo "BLOCKED: $WEB_DOMAIN HTTPS sertifikati hali yo'q. Kamera/mikrofonning tashqi telefon testi uchun HTTPS shart."
fi

if sudo test -f "$RTC_CERT" && sudo test -f "$RTC_KEY"; then
  write_https_site qdturtc "$RTC_DOMAIN" "$SFU_PORT" "$RTC_CERT" "$RTC_KEY"
else
  write_http_site qdturtc "$RTC_DOMAIN" "$SFU_PORT"
  echo "BLOCKED: $RTC_DOMAIN HTTPS sertifikati hali yo'q."
fi

sudo ln -sfn /etc/nginx/sites-available/qdtu-edu /etc/nginx/sites-enabled/qdtu-edu
sudo ln -sfn /etc/nginx/sites-available/qdturtc /etc/nginx/sites-enabled/qdturtc
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

say "Local health checks"
for i in {1..20}; do
  if curl -fsS "http://127.0.0.1:$APP_PORT/health" >/tmp/masofaviy-health.json; then break; fi
  sleep 1
done
curl -fsS "http://127.0.0.1:$APP_PORT/health" || fail "main web health failed"
echo
curl -fsS "http://127.0.0.1:$SFU_PORT/health" || fail "SFU health failed"
echo
curl -fsS -H "Host: $WEB_DOMAIN" http://127.0.0.1/health >/dev/null || fail "Nginx web proxy failed"
curl -fsS -H "Host: $RTC_DOMAIN" http://127.0.0.1/health >/dev/null || fail "Nginx RTC proxy failed"

if ! grep -q '"db":"connected"' /tmp/masofaviy-health.json; then
  echo "FAILED: main /health MongoDB connected emas:"
  cat /tmp/masofaviy-health.json
  exit 1
fi

say "Service status"
systemctl --no-pager --full status masofaviy.service | sed -n '1,12p'
systemctl --no-pager --full status qdtusfu.service | sed -n '1,12p'

cat <<EOF

DONE: local production stack ishga tushdi.
Main local: http://127.0.0.1:$APP_PORT
RTC local:  http://127.0.0.1:$SFU_PORT
Main domain: https://$WEB_DOMAIN
RTC domain:  https://$RTC_DOMAIN

Tashqi telefon testi uchun universitet routerida kamida:
  TCP 80  -> 192.168.50.11:80
  TCP 443 -> 192.168.50.11:443
  UDP 40000-40001 -> 192.168.50.11:40000-40001
  TCP 40000-40001 -> 192.168.50.11:40000-40001
forward bo'lishi kerak.
TURN ishlatilsa uning public relay portlari ham routerda ochilishi kerak.
EOF
