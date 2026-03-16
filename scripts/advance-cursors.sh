#!/usr/bin/env bash
# Advance all message cursors to "now" so the bot doesn't replay old messages.
# Run AFTER stopping the service and BEFORE restarting it.
set -euo pipefail

DB="${1:-$(dirname "$0")/../store/messages.db}"
NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)

# Advance the polling-loop cursor
sqlite3 "$DB" "UPDATE router_state SET value = '$NOW' WHERE key = 'last_timestamp'"

# Advance all per-session agent cursors (used by recoverPendingMessages on startup)
sqlite3 "$DB" "SELECT value FROM router_state WHERE key = 'last_agent_timestamp'" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const o=JSON.parse(d);console.log(JSON.stringify(Object.fromEntries(Object.keys(o).map(k=>[k,'$NOW']))))})" \
  > /tmp/nanoclaw_agent_ts.json

sqlite3 "$DB" "UPDATE router_state SET value = readfile('/tmp/nanoclaw_agent_ts.json') WHERE key = 'last_agent_timestamp'"
rm -f /tmp/nanoclaw_agent_ts.json

echo "All cursors advanced to $NOW"
