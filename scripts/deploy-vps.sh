#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
staging=${1:?Missing deployment directory}
[[ "$staging" =~ ^/tmp/bao-gia-deploy\.[a-zA-Z0-9]+$ ]] || exit 1
source "$staging/deploy.conf"
APP_PORT=${APP_PORT:-3013}
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
network_args=()
if [[ -n "${DOCKER_NETWORK:-}" ]]; then
  if ! docker network inspect "$DOCKER_NETWORK" >/dev/null 2>&1; then
    echo "DOCKER_NETWORK does not exist on the VPS. Use the existing MongoDB network in ENV_FILE." >&2
    exit 1
  fi
  network_args=(--network "$DOCKER_NETWORK")
fi
docker login ghcr.io --username "$GHCR_USER" --password-stdin < "$staging/ghcr.token"
docker pull "$IMAGE"
docker tag "$IMAGE" "$IMAGE_TAG"
# Inspect only networking metadata, never other containers' environment.
docker ps -q > "$staging/container-ids"
: > "$staging/networks.jsonl"
while IFS= read -r container_id; do
  [[ -n "$container_id" ]] || continue
  docker inspect --format '{"name":{{json .Name}},"networks":{{json .NetworkSettings.Networks}},"ports":{{json .NetworkSettings.Ports}}}' "$container_id" >> "$staging/networks.jsonl"
done < "$staging/container-ids"
{
  cat "$staging/app.env"
  printf '\0'
  cat "$staging/networks.jsonl"
} | docker run --rm -i --network none -e "DEPLOY_NETWORK=${DOCKER_NETWORK:-}" --entrypoint node "$IMAGE" \
  --input-type=module -e "$(cat "$staging/resolve-mongo-network.mjs")" > "$staging/resolved-config"
IFS= read -r resolved_network < "$staging/resolved-config" || true
tail -n +2 "$staging/resolved-config" > "$staging/app.env"
if [[ -n "$resolved_network" ]]; then
  [[ "$resolved_network" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || exit 1
  docker network inspect "$resolved_network" >/dev/null
  network_args=(--network "$resolved_network")
  echo "Using Docker network for MongoDB connectivity."
fi
check_health() {
  local name=$1
  local state
  for ((attempt=0; attempt<30; attempt++)); do
    if docker exec "$name" node -e 'fetch("http://127.0.0.1:" + process.env.PORT + "/api/health", {signal: AbortSignal.timeout(3000)}).then(async r => {if (!r.ok || (await r.json()).status !== "ok") process.exit(1)}).catch(() => process.exit(1))' >/dev/null 2>&1; then
      return 0
    fi
    state=$(docker inspect --format '{{.State.Status}}' "$name" 2>/dev/null || true)
    if [[ "$state" == exited || "$state" == dead ]]; then break; fi
    sleep 2
  done
  docker inspect --format 'Container status={{.State.Status}} exit={{.State.ExitCode}}' "$name" >&2 || true
  echo "Health check failed for $name" >&2
  echo "Startup logs (configuration values redacted):" >&2
  # Keep raw logs in the private staging directory. Only sanitized output
  # reaches Actions; use Node from the image, not a VPS Node installation.
  docker logs --tail 100 "$name" > "$staging/startup.log" 2>&1 || true
  if ! docker run --rm -i --env-file "$staging/app.env" --entrypoint node "$IMAGE" \
    --input-type=module -e "$(cat "$staging/redact-container-logs.mjs")" < "$staging/startup.log"; then
    echo "Unable to sanitize startup logs; raw output withheld. Inspect application logs directly on the VPS." >&2
  fi
  return 1
}
# Verify startup before touching the running container or its port.
docker run -d --name "$candidate" "${network_args[@]}" --env-file "$staging/app.env" "$IMAGE_TAG" >/dev/null
check_health "$candidate"
docker rm -f "$candidate" >/dev/null
if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  old_running=$(docker inspect --format '{{.State.Running}}' "$CONTAINER")
  docker rename "$CONTAINER" "$backup"
  old_moved=true
  docker stop "$backup" >/dev/null
fi
docker create --name "$CONTAINER" --restart unless-stopped \
  "${network_args[@]}" \
  --env-file "$staging/app.env" -p "$BIND_ADDRESS:$HOST_PORT:$APP_PORT" \
  --label app=bao-gia "$IMAGE_TAG" >/dev/null
new_created=true
docker start "$CONTAINER" >/dev/null
check_health "$CONTAINER"
if [[ "$old_moved" == true ]]; then docker rm "$backup" >/dev/null; fi
echo "Deployment healthy: $CONTAINER ($IMAGE_TAG), listening on $BIND_ADDRESS:$HOST_PORT"
