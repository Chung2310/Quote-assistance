#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
staging=$(mktemp -d)
remote=""
cleanup() {
  status=$?
  trap - EXIT
  if [[ -n "$remote" ]]; then
    ssh "${ssh_args[@]}" "$VPS_USER@$VPS_HOST" "rm -rf -- '$remote'" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$staging"
  exit "$status"
}
trap cleanup EXIT
node scripts/prepare-deploy.mjs "$staging"
ssh_args=(-i "$staging/ssh-key" -p "$VPS_SSH_PORT" -o BatchMode=yes -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$staging/known_hosts"
  -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
remote=$(ssh "${ssh_args[@]}" "$VPS_USER@$VPS_HOST" 'umask 077; mktemp -d /tmp/bao-gia-deploy.XXXXXXXX')
if [[ ! "$remote" =~ ^/tmp/bao-gia-deploy\.[a-zA-Z0-9]+$ ]]; then
  remote=""
  echo "VPS returned an invalid staging directory" >&2
  exit 1
fi
{
  printf 'IMAGE=%q\n' "$IMAGE"
  printf 'GHCR_USER=%q\n' "$GHCR_USER"
  printf 'CONTAINER=%q\n' "$VPS_CONTAINER_NAME"
  printf 'HOST_PORT=%q\n' "$VPS_APP_PORT"
  printf 'BIND_ADDRESS=%q\n' "$VPS_BIND_ADDRESS"
} > "$staging/deploy.conf"
cp scripts/deploy-vps.sh "$staging/deploy-vps.sh"
# Tar uses the existing SSH channel; credentials are never command arguments.
tar -C "$staging" -cf - app.env ghcr.token deploy.conf deploy-vps.sh |
  ssh "${ssh_args[@]}" "$VPS_USER@$VPS_HOST" "tar -xf - -C '$remote'"
ssh "${ssh_args[@]}" "$VPS_USER@$VPS_HOST" "bash '$remote/deploy-vps.sh' '$remote'"
