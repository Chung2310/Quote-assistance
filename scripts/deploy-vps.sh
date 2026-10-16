#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
staging=${1:?Missing deployment directory}
[[ "$staging" =~ ^/tmp/bao-gia-deploy\.[a-zA-Z0-9]+$ ]] || exit 1
source "$staging/deploy.conf"
export DOCKER_CONFIG="$staging/docker"
backup="$CONTAINER-previous-${staging##*.}"
candidate="$CONTAINER-candidate-${staging##*.}"
old_moved=false
new_created=false
old_running=false
cleanup() {
  status=$?
  trap - EXIT
  set +e
  docker rm -f "$candidate" >/dev/null 2>&1
  if (( status != 0 )); then
    echo "Deployment failed; restoring previous container if available." >&2
    if [[ "$new_created" == true ]]; then docker rm -f "$CONTAINER" >/dev/null; fi
    if [[ "$old_moved" == true ]]; then
      docker rename "$backup" "$CONTAINER"
      if [[ "$old_running" == true ]]; then docker start "$CONTAINER"; fi
    fi
  fi
  rm -rf -- "$staging"
  exit "$status"
}
trap cleanup EXIT
command -v flock >/dev/null
exec 9>"/tmp/bao-gia-$CONTAINER.lock"
flock -w 300 9
docker info >/dev/null
docker login ghcr.io --username "$GHCR_USER" --password-stdin < "$staging/ghcr.token"
docker pull "$IMAGE"
check_health() {
  local name=$1
  for ((attempt=0; attempt<30; attempt++)); do
    if docker exec "$name" node -e 'fetch("http://127.0.0.1:3013/api/health", {signal: AbortSignal.timeout(3000)}).then(async r => {if (!r.ok || (await r.json()).status !== "ok") process.exit(1)}).catch(() => process.exit(1))' >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  docker inspect --format 'Container status={{.State.Status}} exit={{.State.ExitCode}}' "$name" >&2 || true
  echo "Health check failed for $name" >&2
  return 1
}
# Verify startup before touching the running container or its port.
docker run -d --name "$candidate" --env-file "$staging/app.env" "$IMAGE" >/dev/null
check_health "$candidate"
docker rm -f "$candidate" >/dev/null
if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  old_running=$(docker inspect --format '{{.State.Running}}' "$CONTAINER")
  docker rename "$CONTAINER" "$backup"
  old_moved=true
  docker stop "$backup" >/dev/null
fi
docker create --name "$CONTAINER" --restart unless-stopped \
  --env-file "$staging/app.env" -p "$BIND_ADDRESS:$HOST_PORT:3013" \
  --label app=bao-gia "$IMAGE" >/dev/null
new_created=true
docker start "$CONTAINER" >/dev/null
check_health "$CONTAINER"
if [[ "$old_moved" == true ]]; then docker rm "$backup" >/dev/null; fi
echo "Deployment healthy: $CONTAINER ($IMAGE), listening on $BIND_ADDRESS:$HOST_PORT"
