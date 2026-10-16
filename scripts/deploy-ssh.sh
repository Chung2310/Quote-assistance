#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
staging=$(mktemp -d)
remote=""
cleanup() {
  status=$?
  trap - EXIT
  if [[ -n "$remote" ]]; then
    ssh "${ssh_args[@]}" "$SSH_USER@$SSH_HOST" "rm -rf -- '$remote'" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$staging"
  exit "$status"
}
trap cleanup EXIT
node scripts/prepare-deploy.mjs "$staging"
app_port=$(cat "$staging/app-port")
ssh_args=(-i "$staging/ssh-key" -p "$SSH_PORT" -o BatchMode=yes -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=accept-new -o "UserKnownHostsFile=$staging/known_hosts"
  -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
remote=$(ssh "${ssh_args[@]}" "$SSH_USER@$SSH_HOST" 'umask 077; mktemp -d /tmp/bao-gia-deploy.XXXXXXXX')
if [[ ! "$remote" =~ ^/tmp/bao-gia-deploy\.[a-zA-Z0-9]+$ ]]; then
  remote=""
  echo "VPS returned an invalid staging directory" >&2
  exit 1
fi
{
  printf 'IMAGE=%q\n' "$IMAGE"
  printf 'GHCR_USER=%q\n' "$GHCR_USER"
  printf 'CONTAINER=%q\n' "bao-gia"
  printf 'HOST_PORT=%q\n' "$app_port"
  printf 'APP_PORT=%q\n' "$app_port"
  printf 'DOCKER_NETWORK=%q\n' "$(cat "$staging/docker-network")"
  printf 'BIND_ADDRESS=%q\n' "127.0.0.1"
} > "$staging/deploy.conf"
cp scripts/deploy-vps.sh "$staging/deploy-vps.sh"
cp scripts/redact-container-logs.mjs "$staging/redact-container-logs.mjs"
cp scripts/resolve-mongo-network.mjs "$staging/resolve-mongo-network.mjs"
# Tar uses the existing SSH channel; credentials are never command arguments.
tar -C "$staging" -cf - app.env ghcr.token deploy.conf deploy-vps.sh redact-container-logs.mjs resolve-mongo-network.mjs |
  ssh "${ssh_args[@]}" "$SSH_USER@$SSH_HOST" "tar -xf - -C '$remote'"
ssh "${ssh_args[@]}" "$SSH_USER@$SSH_HOST" "bash '$remote/deploy-vps.sh' '$remote'"
