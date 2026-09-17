#!/usr/bin/env bash
set -Eeuo pipefail
APP_DIR="${APP_DIR:-/home/hallaym/masofaviy}"
ENV_FILE="$APP_DIR/.env"
SFU_ENV="$APP_DIR/sfu/.env"
cd "$APP_DIR"
[ -f "$ENV_FILE" ] || cp .env.example "$ENV_FILE"
chmod 600 "$ENV_FILE"

python3 - "$ENV_FILE" "$SFU_ENV" <<'PY'
import os,re,secrets,sys
from pathlib import Path

env_path=Path(sys.argv[1]); sfu_path=Path(sys.argv[2])

def parse(p):
    out={}
    if not p.exists(): return out
    for raw in p.read_text(errors='ignore').splitlines():
        if not raw or raw.lstrip().startswith('#') or '=' not in raw: continue
        k,v=raw.split('=',1); out[k.strip()]=v.strip()
    return out

def write(p,data,base_lines=None):
    base=base_lines if base_lines is not None else (p.read_text(errors='ignore').splitlines() if p.exists() else [])
    seen=set(); out=[]
    for raw in base:
        if '=' in raw and not raw.lstrip().startswith('#'):
            k=raw.split('=',1)[0].strip()
            if k in data:
                out.append(f'{k}={data[k]}'); seen.add(k); continue
        out.append(raw)
    for k,v in data.items():
        if k not in seen: out.append(f'{k}={v}')
    p.write_text('\n'.join(out).rstrip()+'\n')

main=parse(env_path); sfu=parse(sfu_path)
uri=main.get('MONGODB_URI','').strip()
if not uri:
    candidates=[]
    root=Path('/home/hallaym')
    for p in root.rglob('*'):
        if not p.is_file(): continue
        if p.name not in {'.env','.env.production','.env.local','.env.example'}: continue
        if any(x in p.parts for x in ('.git','node_modules')): continue
        try: text=p.read_text(errors='ignore')
        except Exception: continue
        for line in text.splitlines():
            if line.startswith(('MONGODB_URI=','MONGO_URI=')):
                val=line.split('=',1)[1].strip()
                if val.startswith('mongodb+srv://'):
                    score=2 if '@abu2.' in val else 1
                    candidates.append((score,val,p))
    if candidates:
        candidates.sort(key=lambda x:x[0],reverse=True)
        uri=candidates[0][1]
if not uri:
    raise SystemExit('FAILED: serverdagi mavjud .env fayllardan MongoDB Atlas URI topilmadi')
uri=re.sub(r'(mongodb\.net/)([^?]*)',r'\1masofaviy',uri,count=1)
main['MONGODB_URI']=uri
main['DB_NAME']='masofaviy'
main['NODE_ENV']='production'
main['PORT']=main.get('PORT') or '10000'
main['RTC_BRIDGE_URL']='https://rtc.hallaym.com'
main['SESSION_DAYS']=main.get('SESSION_DAYS') or '180'
main['RECORDINGS_DIR']=main.get('RECORDINGS_DIR') or '/home/hallaym/masofaviy/storage/recordings'
if not main.get('JWT_SECRET') or main.get('JWT_SECRET')=='change-this-to-a-long-random-secret':
    main['JWT_SECRET']=secrets.token_hex(48)
rtc=sfu.get('RTC_TOKEN_SECRET') or main.get('RTC_TOKEN_SECRET')
if not rtc:
    rtc=secrets.token_hex(48)
main['RTC_TOKEN_SECRET']=rtc
if sfu_path.exists():
    sfu['RTC_TOKEN_SECRET']=rtc
    write(sfu_path,sfu)
    os.chmod(sfu_path,0o600)
write(env_path,main)
os.chmod(env_path,0o600)
print('DONE: production .env tayyor; MongoDB database=masofaviy; secret qiymatlar chiqarilmadi')
PY
