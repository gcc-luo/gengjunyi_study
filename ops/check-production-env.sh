#!/bin/sh
set -eu

fail() {
  echo "Production preflight failed: $1" >&2
  exit 1
}

check_public_domain_shape() {
  domain_name=$1
  domain_value=$2
  domain_lower=$(printf '%s' "$domain_value" | tr '[:upper:]' '[:lower:]')
  case "$domain_value" in
    ""|*[!A-Za-z0-9.-]*|.*|*.) fail "$domain_name must be a DNS hostname" ;;
  esac
  [ "${#domain_value}" -le 253 ] || fail "$domain_name is too long"
  case "$domain_value" in
    *.*) ;;
    *) fail "$domain_name must be a fully qualified hostname" ;;
  esac
  case "$domain_value" in
    *[A-Za-z]*) ;;
    *) fail "$domain_name must be a hostname, not an IP address" ;;
  esac
  case "$domain_lower" in
    *..*|*.-*|*-.*|localhost|*.localhost|*.local|*.lan|*.home|*.internal|*.test|*.invalid|example.com|*.example.com|example.net|*.example.net|example.org|*.example.org|example|*.example)
      fail "$domain_name must not use a reserved or local hostname"
      ;;
  esac
}

check_public_domain_shape APP_DOMAIN "$APP_DOMAIN"
check_public_domain_shape S3_DOMAIN "$S3_DOMAIN"
[ "$APP_ORIGIN" = "https://$APP_DOMAIN" ] || fail "APP_ORIGIN must exactly match the HTTPS APP_DOMAIN"
[ "$S3_DOMAIN" != "$APP_DOMAIN" ] || fail "S3_DOMAIN must differ from APP_DOMAIN"

check_hex_secret() {
  secret_name=$1
  secret=$2
  [ "${#secret}" -ge 32 ] || fail "$secret_name must contain at least 32 characters"
  case "$secret" in
    *[!a-f0-9]*) fail "$secret_name must use lowercase hexadecimal characters" ;;
  esac
}

check_hex_secret POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
check_hex_secret MINIO_ROOT_PASSWORD "$MINIO_ROOT_PASSWORD"
check_hex_secret MINIO_APP_SECRET_KEY "$MINIO_APP_SECRET_KEY"

[ "${#SESSION_SECRET}" -ge 64 ] || fail "SESSION_SECRET must contain at least 64 base64 characters"
case "$SESSION_SECRET" in
  replace_with_*) fail "replace the example SESSION_SECRET" ;;
  *[!A-Za-z0-9+/=]*) fail "SESSION_SECRET must use the base64 alphabet" ;;
esac
session_unique_characters=$(printf '%s' "$SESSION_SECRET" | fold -w 1 | sort -u | wc -l | tr -d '[:space:]')
[ "$session_unique_characters" -ge 16 ] || fail "SESSION_SECRET does not appear sufficiently random"
[ "$POSTGRES_PASSWORD" != "$MINIO_ROOT_PASSWORD" ] || fail "database and MinIO root secrets must differ"
[ "$POSTGRES_PASSWORD" != "$MINIO_APP_SECRET_KEY" ] || fail "database and MinIO application secrets must differ"
[ "$POSTGRES_PASSWORD" != "$SESSION_SECRET" ] || fail "database and session secrets must differ"
[ "$MINIO_ROOT_PASSWORD" != "$MINIO_APP_SECRET_KEY" ] || fail "MinIO root and application secrets must differ"
[ "$MINIO_ROOT_PASSWORD" != "$SESSION_SECRET" ] || fail "MinIO root and session secrets must differ"
[ "$MINIO_APP_SECRET_KEY" != "$SESSION_SECRET" ] || fail "MinIO application and session secrets must differ"

echo "Production domains and secrets passed preflight checks."
