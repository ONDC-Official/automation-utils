#!/usr/bin/env bash
# ./ingest-spec.sh -f build.yaml -u https://api.example.com -k your-api-key
set -euo pipefail

usage() {
  echo "Usage: $0 -f <build.yaml> -u <base_url> -k <x-api-key>"
  echo "  -f  Path to the build.yaml file"
  echo "  -u  Base URL (e.g. https://api.example.com)"
  echo "  -k  x-api-key value"
  exit 1
}

FILE=""
BASE_URL=""
API_KEY=""

while getopts ":f:u:k:" opt; do
  case $opt in
    f) FILE="$OPTARG" ;;
    u) BASE_URL="$OPTARG" ;;
    k) API_KEY="$OPTARG" ;;
    *) usage ;;
  esac
done

[[ -z "$FILE" || -z "$BASE_URL" || -z "$API_KEY" ]] && usage
[[ ! -f "$FILE" ]] && { echo "Error: file '$FILE' not found"; exit 1; }

ENDPOINT="${BASE_URL%/}/protocol-specs/specs"
GZIP_FILE="/tmp/$(basename "$FILE").gz"

echo "Gzipping '$FILE' -> $GZIP_FILE ..."
gzip -c "$FILE" > "$GZIP_FILE"

echo "POSTing to $ENDPOINT ..."

HTTP_STATUS=$(curl -s -o /tmp/ingest_response.json -w "%{http_code}" \
  -X POST "$ENDPOINT" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@$GZIP_FILE")

echo "HTTP Status: $HTTP_STATUS"
echo "Response:"
cat /tmp/ingest_response.json
echo
