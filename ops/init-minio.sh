#!/bin/sh
set -eu

MINIO_APP_ACCESS_KEY=family_learning_api
if [ "$MINIO_APP_ACCESS_KEY" = "$MINIO_ROOT_USER" ]; then
  echo "The application access key must differ from the MinIO root user." >&2
  exit 1
fi
case "$MINIO_BUCKET" in
  ""|*[!a-z0-9.-]*|.*|*.)
    echo "MINIO_BUCKET must be a lowercase DNS-compatible bucket name." >&2
    exit 1
    ;;
esac
if [ "${#MINIO_BUCKET}" -lt 3 ] || [ "${#MINIO_BUCKET}" -gt 63 ]; then
  echo "MINIO_BUCKET must contain between 3 and 63 characters." >&2
  exit 1
fi
bucket_marker=/state/family-learning-minio-bucket
mkdir -p /state
if [ -f "$bucket_marker" ]; then
  initial_bucket=$(cat "$bucket_marker")
  if [ "$initial_bucket" != "$MINIO_BUCKET" ]; then
    echo "MINIO_BUCKET is immutable after initialization; refusing to hide existing media." >&2
    exit 1
  fi
else
  initial_bucket=
fi

mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
mc ready local
if [ -z "$initial_bucket" ]; then
  printf '%s\n' "$MINIO_BUCKET" > "$bucket_marker"
fi
mc mb --ignore-existing "local/$MINIO_BUCKET"
mc anonymous set none "local/$MINIO_BUCKET"

policy_file=$(mktemp)
trap 'rm -f "$policy_file"' EXIT
printf '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:AbortMultipartUpload","s3:DeleteObject","s3:GetObject","s3:ListBucket","s3:ListMultipartUploadParts","s3:PutObject"],"Resource":["arn:aws:s3:::%s","arn:aws:s3:::%s/*"]}]}' \
  "$MINIO_BUCKET" "$MINIO_BUCKET" > "$policy_file"

if mc admin user info local "$MINIO_APP_ACCESS_KEY" >/dev/null 2>&1; then
  mc admin user rm local "$MINIO_APP_ACCESS_KEY"
fi
if mc admin policy info local family-learning-app >/dev/null 2>&1; then
  mc admin policy rm local family-learning-app
fi

mc admin policy create local family-learning-app "$policy_file"
mc admin user add local "$MINIO_APP_ACCESS_KEY" "$MINIO_APP_SECRET_KEY"
mc admin policy attach local family-learning-app --user "$MINIO_APP_ACCESS_KEY"
echo "Private application bucket and restricted MinIO account are ready."
