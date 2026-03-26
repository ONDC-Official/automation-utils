#!/usr/bin/env bash
# ./ingest-spec.sh -f build.yaml -t raw_table.json -u https://api.example.com
# API key is read from X_API_KEY env var (set it in .env or export it).
# Override with -k only if needed (avoid — shows up in shell history).
set -euo pipefail

usage() {
  echo "Usage: $0 -f <build.yaml> -t <raw_table.json> -u <base_url> [-k <x-api-key>]"
  echo "  -f  Path to the build.yaml file"
  echo "  -t  Path to the raw_table.json file"
  echo "  -u  Base URL (e.g. https://api.example.com)"
  echo "  -k  x-api-key override (default: \$X_API_KEY env var)"
  exit 1
}

FILE=""
TABLE_FILE=""
BASE_URL=""
API_KEY="${X_API_KEY:-}"   # read from env by default

while getopts ":f:t:u:k:" opt; do
  case $opt in
    f) FILE="$OPTARG" ;;
    t) TABLE_FILE="$OPTARG" ;;
    u) BASE_URL="$OPTARG" ;;
    k) API_KEY="$OPTARG" ;;
    *) usage ;;
  esac
done

[[ -z "$FILE" || -z "$TABLE_FILE" || -z "$BASE_URL" ]] && usage
[[ -z "$API_KEY" ]] && { echo "Error: X_API_KEY is not set (use -k or export X_API_KEY)"; exit 1; }
[[ ! -f "$FILE" ]] && { echo "Error: build file '$FILE' not found"; exit 1; }
[[ ! -f "$TABLE_FILE" ]] && { echo "Error: table file '$TABLE_FILE' not found"; exit 1; }

ENDPOINT="${BASE_URL%/}/protocol-specs/specs"
GZIP_FILE="/tmp/$(basename "$FILE").gz"
GZIP_TABLE_FILE="/tmp/$(basename "$TABLE_FILE").gz"

echo "Gzipping '$FILE' -> $GZIP_FILE ..."
gzip -c "$FILE" > "$GZIP_FILE"

echo "Gzipping '$TABLE_FILE' -> $GZIP_TABLE_FILE ..."
gzip -c "$TABLE_FILE" > "$GZIP_TABLE_FILE"

echo "POSTing to $ENDPOINT ..."

HTTP_STATUS=$(curl -s -o /tmp/ingest_response.json -w "%{http_code}" \
  -X POST "$ENDPOINT" \
  -H "x-api-key: $API_KEY" \
  -F "spec=@$GZIP_FILE;type=application/octet-stream" \
  -F "validationTable=@$GZIP_TABLE_FILE;type=application/octet-stream")

echo "HTTP Status: $HTTP_STATUS"
echo "Response:"
cat /tmp/ingest_response.json
echo
