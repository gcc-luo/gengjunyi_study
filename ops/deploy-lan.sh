#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env.lan"
COMPOSE_FILE="$ROOT_DIR/ops/compose.lan.yaml"
PROJECT_NAME="family-learning-lan"

usage() {
  cat <<'USAGE'
Usage: bash ./ops/deploy-lan.sh [--help]

Deploy the family learning app to an Ubuntu server for access from the same LAN.
Docker Engine and the Docker Compose plugin must already be installed and running.

Optional override:
  BIND_IP=192.168.1.20 bash ./ops/deploy-lan.sh
  APP_ORIGIN=http://123.57.228.45:8189 \
  MINIO_PUBLIC_URL=http://123.57.228.45:9000 bash ./ops/deploy-lan.sh

By default, TCP 8189 (web) and 9000 (MinIO S3) listen on all interfaces (0.0.0.0),
so localhost and LAN clients can connect. Client URLs use the LAN IP discovered
from the default route; reserve that IP in your router for a stable address.
Set BIND_IP to a specific local IPv4 to restrict listening.
APP_ORIGIN and MINIO_PUBLIC_URL can be overridden for an HTTP tunnel/public endpoint.
USAGE
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi
if [[ $# -gt 0 ]]; then
  usage >&2
  exit 2
fi

for required_command in docker ip awk grep mktemp hostname; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$required_command" >&2
    exit 1
  fi
done

if ! docker info >/dev/null 2>&1; then
  echo "Docker is missing or not running. Install/start Docker Engine, then rerun this script." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is missing. Install the Docker Compose plugin, then rerun this script." >&2
  exit 1
fi

discover_bind_ip() {
  local detected
  detected="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1; i<=NF; i++) if ($i == "src") {print $(i+1); exit}}')"
  if [[ -z "$detected" ]]; then
    detected="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  printf '%s' "$detected"
}

if [[ ! -f "$ENV_FILE" ]]; then
  umask 077
  cp -- "$ROOT_DIR/ops/.env.lan.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

host_ip="$(discover_bind_ip)"
bind_ip="${BIND_IP:-0.0.0.0}"
if [[ -z "$host_ip" ]]; then
  printf 'Could not discover a local IPv4 address. Set APP_ORIGIN and MINIO_PUBLIC_URL to reachable URLs and rerun.\n' >&2
  exit 1
fi
if [[ "$bind_ip" != "0.0.0.0" ]] && ! ip -4 -o addr show | awk '{split($4, address, "/"); print address[1]}' | grep -Fxq "$bind_ip"; then
  printf 'BIND_IP must be 0.0.0.0 or a local IPv4 address (selected: %s).\n' "${bind_ip:-none}" >&2
  exit 1
fi

set_env_value() {
  local key="$1"
  local value="$2"
  local temporary_file
  temporary_file="$(mktemp "${ENV_FILE}.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { updated = 0 }
    index($0, key "=") == 1 && !updated { print key "=" value; updated = 1; next }
    { print }
    END { if (!updated) print key "=" value }
  ' "$ENV_FILE" > "$temporary_file"
  chmod 600 "$temporary_file"
  mv -- "$temporary_file" "$ENV_FILE"
}

read_env_value() {
  local key="$1"
  awk -F= -v key="$key" '$1 == key {sub(/^[^=]*=/, ""); print; exit}' "$ENV_FILE"
}

previous_bind_ip="$(read_env_value BIND_IP)"
previous_host_ip="$(read_env_value LAN_HOST_IP)"
if [[ -z "$previous_host_ip" && "$previous_bind_ip" != "0.0.0.0" ]]; then
  previous_host_ip="$previous_bind_ip"
fi
previous_app_origin="$(read_env_value APP_ORIGIN)"
previous_app_allowed_origins="$(read_env_value APP_ALLOWED_ORIGINS)"
previous_managed_origins="${previous_app_origin},http://localhost:8189,http://127.0.0.1:8189"
app_origin="${APP_ORIGIN:-$(read_env_value APP_ORIGIN)}"
minio_public_url="${MINIO_PUBLIC_URL:-$(read_env_value MINIO_PUBLIC_URL)}"

if [[ -z "$app_origin" || "$app_origin" == "http://127.0.0.1:8189" || "$app_origin" == "http://${previous_host_ip}:8189" ]]; then
  app_origin="http://${host_ip}:8189"
fi
if [[ -z "$minio_public_url" || "$minio_public_url" == "http://127.0.0.1:9000" || "$minio_public_url" == "http://${previous_host_ip}:9000" ]]; then
  minio_public_url="http://${host_ip}:9000"
fi
if [[ -n "${APP_ALLOWED_ORIGINS:-}" ]]; then
  app_allowed_origins="$APP_ALLOWED_ORIGINS"
elif [[ -z "$previous_app_allowed_origins" || "$previous_app_allowed_origins" == "$previous_managed_origins" || "$previous_app_allowed_origins" == "$previous_app_origin" ]]; then
  app_allowed_origins="${app_origin},http://localhost:8189,http://127.0.0.1:8189"
else
  app_allowed_origins="$previous_app_allowed_origins"
fi

set_env_value BIND_IP "$bind_ip"
set_env_value LAN_HOST_IP "$host_ip"
set_env_value APP_ORIGIN "$app_origin"
set_env_value APP_ALLOWED_ORIGINS "$app_allowed_origins"
set_env_value MINIO_PUBLIC_URL "$minio_public_url"

compose=(docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" --file "$COMPOSE_FILE")

on_error() {
  local status=$?
  trap - ERR
  printf '\nDeployment failed (exit %s). Recent service status and logs:\n' "$status" >&2
  "${compose[@]}" ps >&2 || true
  "${compose[@]}" logs --tail=80 postgres minio minio-init migrate api caddy >&2 || true
  exit "$status"
}
trap on_error ERR

"${compose[@]}" config -q
"${compose[@]}" up -d --build
"${compose[@]}" --profile bootstrap run --rm admin

healthy=false
for ((attempt = 1; attempt <= 45; attempt++)); do
  if health="$("${compose[@]}" exec -T caddy wget -qO- http://127.0.0.1:8080/api/health 2>/dev/null)" && [[ "$health" == *'"status":"ok"'* ]]; then
    healthy=true
    break
  fi
  sleep 2
done
if [[ "$healthy" != true ]]; then
  echo "The app did not become healthy within 90 seconds." >&2
  exit 1
fi

cat <<SUMMARY

Deployment is ready.
Web:       ${app_origin}
MinIO S3:  ${minio_public_url} (used by video uploads and playback)
Access:    Login disabled; every visitor has full parent-management access.

Use the web address on a phone connected to the same LAN or through your configured tunnel.
This deployment uses plain HTTP and disables authentication. Anyone who can reach the address
can manage children, courses, uploads, and learning records. The bootstrap admin account is
only used to create application sessions; reruns do not reset its password.
Data is kept in Docker volumes. Do not run 'docker compose down -v' for this project.
SUMMARY
