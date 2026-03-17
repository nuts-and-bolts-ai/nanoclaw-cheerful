#!/usr/bin/env bash
# Advance all message cursors to "now" so the bot doesn't replay old messages.
# Run AFTER stopping the service and BEFORE restarting it.
set -euo pipefail

DB="${1:-$(dirname "$0")/../store/messages.db}"
NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)

# Advance the polling-loop cursor
sqlite3 "$DB" "UPDATE router_state SET value = '$NOW' WHERE key = 'last_timestamp'"

# Advance all per-session agent cursors (used by recoverPendingMessages on startup).
# Also seed entries for all registered groups' chatJids so newly registered groups
# that only had thread-level cursors get a channel-level cursor too.
REGISTERED_JIDS=$(sqlite3 "$DB" "SELECT chat_jid FROM registered_groups" | tr '\n' '|')

sqlite3 "$DB" "SELECT value FROM router_state WHERE key = 'last_agent_timestamp'" \
  | node -e "
    let d='';
    process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{
      const o=JSON.parse(d);
      // Advance all existing keys
      for(const k of Object.keys(o)) o[k]='$NOW';
      // Seed channel-level entries for all registered groups
      const jids='$REGISTERED_JIDS'.split('|').filter(Boolean);
      for(const jid of jids) if(!(jid in o)) o[jid]='$NOW';
      console.log(JSON.stringify(o));
    })" \
  > /tmp/nanoclaw_agent_ts.json

sqlite3 "$DB" "UPDATE router_state SET value = readfile('/tmp/nanoclaw_agent_ts.json') WHERE key = 'last_agent_timestamp'"
rm -f /tmp/nanoclaw_agent_ts.json

echo "All cursors advanced to $NOW"
