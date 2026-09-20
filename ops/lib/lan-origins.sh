#!/usr/bin/env bash

merge_allowed_origins() {
  local combined="${1:-}"
  shift || true

  local origin
  for origin in "$@"; do
    combined="${combined:+${combined},}${origin}"
  done

  awk -v origins="$combined" '
    BEGIN {
      count = split(origins, values, ",")
      output = ""
      for (i = 1; i <= count; i++) {
        value = values[i]
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
        if (value == "" || seen[value]++) continue
        output = output (output == "" ? "" : ",") value
      }
      print output
    }
  '
}

resolve_allowed_origins() {
  local override_is_set="$1"
  local override="$2"
  local existing="$3"
  shift 3

  if [[ "$override_is_set" == "true" ]]; then
    printf '%s\n' "$override"
    return
  fi

  merge_allowed_origins "$existing" "$@"
}
