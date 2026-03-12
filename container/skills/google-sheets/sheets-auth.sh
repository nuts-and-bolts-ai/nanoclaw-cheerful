#!/bin/bash
# Google Sheets API auth via service account JWT
# Usage: TOKEN=$(sheets-auth.sh) → outputs access token to stdout
# Requires: GOOGLE_SERVICE_ACCOUNT_JSON env var, openssl, curl
set -euo pipefail
umask 077

CACHE_FILE="/tmp/gsheets-token"
CACHE_EXPIRY="/tmp/gsheets-token-expiry"

# Return cached token if still valid (>60s remaining)
if [[ -f "$CACHE_FILE" && -f "$CACHE_EXPIRY" ]]; then
  expiry=$(cat "$CACHE_EXPIRY")
  now=$(date +%s)
  if (( expiry - now > 60 )); then
    cat "$CACHE_FILE"
    exit 0
  fi
fi

if [[ -z "${GOOGLE_SERVICE_ACCOUNT_JSON:-}" ]]; then
  echo "ERROR: GOOGLE_SERVICE_ACCOUNT_JSON not set" >&2
  exit 1
fi

# Extract fields from service account JSON
client_email=$(echo "$GOOGLE_SERVICE_ACCOUNT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['client_email'])")
private_key=$(echo "$GOOGLE_SERVICE_ACCOUNT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['private_key'])")

# Build JWT
now=$(date +%s)
exp=$((now + 3600))
header=$(echo -n '{"alg":"RS256","typ":"JWT"}' | openssl base64 -e | tr -d '\n=' | tr '+/' '-_')
claims=$(echo -n "{\"iss\":\"${client_email}\",\"scope\":\"https://www.googleapis.com/auth/spreadsheets\",\"aud\":\"https://oauth2.googleapis.com/token\",\"iat\":${now},\"exp\":${exp}}" | openssl base64 -e | tr -d '\n=' | tr '+/' '-_')

# Sign
signing_input="${header}.${claims}"
signature=$(echo -n "$signing_input" | openssl dgst -sha256 -sign <(printf '%s\n' "$private_key") | openssl base64 -e | tr -d '\n=' | tr '+/' '-_')
jwt="${signing_input}.${signature}"

# Exchange for access token
response=$(curl -s -X POST https://oauth2.googleapis.com/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}")

token=$(echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null)

if [[ -z "$token" ]]; then
  echo "ERROR: Failed to get access token. Response: $response" >&2
  exit 1
fi

# Cache token
echo -n "$token" > "$CACHE_FILE"
echo -n "$exp" > "$CACHE_EXPIRY"
echo -n "$token"
