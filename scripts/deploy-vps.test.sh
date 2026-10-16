#!/usr/bin/env bash
# Exercise deployment ordering and rollback without Docker or production secrets.
set -Eeuo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
test_dir=$(mktemp -d)
staging=""
trap 'rm -rf -- "$test_dir"; if [[ -n "$staging" ]]; then rm -rf -- "$staging"; fi' EXIT
mkdir "$test_dir/bin"
cat > "$test_dir/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -eu
echo "$*" >> "$MOCK_STATE/commands"
case "$1" in
  info) exit 0 ;;
  login) cat >/dev/null ;;
  pull) [[ "$SCENARIO" != pull-failure ]] ;;
  run|create)
    shift
    while [[ "$1" != --name ]]; do shift; done
    touch "$MOCK_STATE/$2"
    ;;
  container) [[ -f "$MOCK_STATE/$3" ]] ;;
  inspect) [[ -f "$MOCK_STATE/${@: -1}" ]] && echo true ;;
  rename) mv "$MOCK_STATE/$2" "$MOCK_STATE/$3" ;;
  stop|start) [[ -f "$MOCK_STATE/$2" ]] ;;
  rm)
    name=${@: -1}
    [[ -f "$MOCK_STATE/$name" ]] || exit 1
    rm "$MOCK_STATE/$name"
    ;;
  exec)
    if [[ "$SCENARIO" == candidate-failure && "$2" == *-candidate-* ]]; then exit 1; fi
    if [[ "$SCENARIO" == replacement-failure && "$2" == bao-gia-test ]]; then exit 1; fi
    [[ -f "$MOCK_STATE/$2" ]]
    ;;
  *) exit 99 ;;
esac
MOCK
printf '#!/usr/bin/env bash\nexit 0\n' > "$test_dir/bin/sleep"
# Lock acquisition is mocked; rollback tests do not need concurrent processes.
printf '#!/usr/bin/env bash\nexit 0\n' > "$test_dir/bin/flock"
chmod +x "$test_dir/bin/"*
export PATH="$test_dir/bin:$PATH"
for SCENARIO in first-deploy upgrade pull-failure candidate-failure replacement-failure; do
  export SCENARIO
  export MOCK_STATE="$test_dir/$SCENARIO"
  mkdir "$MOCK_STATE"
  if [[ "$SCENARIO" != first-deploy ]]; then touch "$MOCK_STATE/bao-gia-test"; fi
  staging=$(mktemp -d /tmp/bao-gia-deploy.XXXXXXXX)
  printf 'IMAGE=test-image\nGHCR_USER=test-user\nCONTAINER=bao-gia-test\nHOST_PORT=3013\nBIND_ADDRESS=127.0.0.1\n' > "$staging/deploy.conf"
  touch "$staging/app.env" "$staging/ghcr.token"
  result=0
  bash "$root/scripts/deploy-vps.sh" "$staging" > "$MOCK_STATE/output" 2>&1 || result=$?
  [[ ! -d "$staging" ]]
  staging=""
  [[ -f "$MOCK_STATE/bao-gia-test" ]]
  if [[ "$SCENARIO" == first-deploy || "$SCENARIO" == upgrade ]]; then
    [[ "$result" == 0 ]]
  else
    [[ "$result" != 0 ]]
  fi
  if [[ "$SCENARIO" == pull-failure || "$SCENARIO" == candidate-failure ]]; then
    ! grep -q '^stop ' "$MOCK_STATE/commands"
  fi
  if [[ "$SCENARIO" == replacement-failure ]]; then
    grep -q '^rename bao-gia-test-previous-.* bao-gia-test$' "$MOCK_STATE/commands"
    grep -q '^start bao-gia-test$' "$MOCK_STATE/commands"
  fi
  if compgen -G "$MOCK_STATE/bao-gia-test-*" >/dev/null; then exit 1; fi
  echo "PASS $SCENARIO"
done
