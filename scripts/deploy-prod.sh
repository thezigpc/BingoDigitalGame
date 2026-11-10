#!/usr/bin/env bash
# Deploys production to the Linux Docker VM.
#
# Run from Git Bash:  ./scripts/deploy-prod.sh  [--skip-tests]
#
# Host-specific settings (SSH target, key, public URL) come from the git-ignored
# scripts/deploy-prod.local.sh; copy deploy-prod.local.example.sh to start.
#
# Steps: build + test here (the gate), ship the source as a tarball over SSH to
# ~/bingo on the VM, `docker compose up -d --build` there, health-check.
# ~/bingo/data (admin password, settings) and ~/bingo/cloudflared (tunnel
# credentials) live only on the VM and are never touched by this script.
set -euo pipefail

LOCAL_CONFIG="$(dirname "$0")/deploy-prod.local.sh"
[[ -f "$LOCAL_CONFIG" ]] || { echo "Missing $LOCAL_CONFIG (copy deploy-prod.local.example.sh)." >&2; exit 1; }
# shellcheck source=/dev/null
source "$LOCAL_CONFIG"
: "${DEPLOY_HOST:?set it in deploy-prod.local.sh}" "${DEPLOY_KEY:?set it in deploy-prod.local.sh}" "${PUBLIC_URL:?set it in deploy-prod.local.sh}"
HOST="$DEPLOY_HOST"
KEY="$DEPLOY_KEY"
REMOTE_DIR="${REMOTE_DIR:-bingo}"
VM_PORT="${VM_PORT:-3004}"
SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=10 "$HOST")

cd "$(dirname "$0")/.."

echo "==> Building"
npm run build
if [[ "${1:-}" == "--skip-tests" ]]; then
  echo "    Skipping tests (--skip-tests)."
else
  echo "==> Running tests (deploy gate)"
  npm test
fi

echo "==> Rollback snapshot on the NAS (docker-restore bingo latest undoes this deploy)"
"${SSH[@]}" "docker-backup bingo pre-deploy"

echo "==> Shipping source to $HOST:~/$REMOTE_DIR"
tar -czf - \
  --exclude=node_modules --exclude=dist --exclude='*.tsbuildinfo' \
  --exclude=data --exclude=cloudflared --exclude=test --exclude='*.log' --exclude=.env \
  package.json package-lock.json shared server client vendor \
  Dockerfile .dockerignore docker-compose.yml \
  | "${SSH[@]}" "mkdir -p ~/$REMOTE_DIR/data && cd ~/$REMOTE_DIR && rm -rf shared server client vendor && tar -xzf -"

# The image runs as the non-root "node" user (uid 1000) since the Bar Games
# work, so the bind-mounted data dir must be theirs. Files written by older
# root-run images would otherwise make admin saves fail. Idempotent.
echo "==> Data dir ownership (uid 1000)"
"${SSH[@]}" "sudo chown -R 1000:1000 ~/$REMOTE_DIR/data"

echo "==> docker compose up -d --build"
"${SSH[@]}" "cd ~/$REMOTE_DIR && docker compose up -d --build && docker image prune -f >/dev/null"

echo "==> Health checks"
for i in $(seq 1 30); do
  if "${SSH[@]}" "curl -fsS http://127.0.0.1:$VM_PORT/health" >/dev/null 2>&1; then break; fi
  sleep 2
done
"${SSH[@]}" "curl -fsS http://127.0.0.1:$VM_PORT/health" && echo "    VM local: OK"
curl -fsS "$PUBLIC_URL/health" && echo "    $PUBLIC_URL: OK"
