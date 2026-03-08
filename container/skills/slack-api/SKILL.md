---
name: slack-api
description: Read channel history, post messages, and search across Slack workspaces. Use when the user asks to check, analyze, or post to Slack channels.
---

# Slack API

You have access to the Slack Web API via `$SLACK_BOT_TOKEN` (Nuts & Bolts workspace). Use `curl` to make requests.

## Workspace: Nuts & Bolts

Token env var: `$SLACK_BOT_TOKEN`

## Common Operations

### List channels
```bash
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  'https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=200' \
  | python3 -m json.tool
```

### Read channel history
```bash
# Get recent messages from a channel (by channel ID)
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  'https://slack.com/api/conversations.history?channel=CHANNEL_ID&limit=20' \
  | python3 -m json.tool
```

To read a channel by name, first list channels to find the ID, then fetch history.

### Read thread replies
```bash
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  'https://slack.com/api/conversations.replies?channel=CHANNEL_ID&ts=THREAD_TS' \
  | python3 -m json.tool
```

### Post a message
```bash
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel":"CHANNEL_ID","text":"Message text here"}' \
  'https://slack.com/api/chat.postMessage'
```

### Post a message with blocks (rich formatting)
```bash
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "channel":"CHANNEL_ID",
    "text":"Fallback text",
    "blocks":[
      {"type":"section","text":{"type":"mrkdwn","text":"*Bold title*\nSome details here"}}
    ]
  }' \
  'https://slack.com/api/chat.postMessage'
```

### Reply in a thread
```bash
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel":"CHANNEL_ID","text":"Reply text","thread_ts":"PARENT_MESSAGE_TS"}' \
  'https://slack.com/api/chat.postMessage'
```

### Search messages
```bash
# Note: search requires a user token (xoxp-), not a bot token
# Use conversations.history with oldest/latest params as an alternative:
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  'https://slack.com/api/conversations.history?channel=CHANNEL_ID&oldest=UNIX_TS&limit=50' \
  | python3 -m json.tool
```

### Get user info (resolve user IDs to names)
```bash
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  'https://slack.com/api/users.info?user=USER_ID' \
  | python3 -m json.tool
```

### Join a public channel (required before reading some channels)
```bash
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel":"CHANNEL_ID"}' \
  'https://slack.com/api/conversations.join'
```

## Workflow for "analyze channels"

1. **List channels** to find IDs for the channels the user mentions
2. **Join** public channels if needed (bot must be a member to read history)
3. **Read history** for each channel (use `oldest` param for time-based filtering)
4. **Resolve user IDs** to names for readability
5. Analyze the content and report findings or create Linear tickets

## Message timestamps

Slack uses Unix timestamps with microseconds (e.g., `1709654321.123456`).
- `oldest` — only messages after this timestamp
- `latest` — only messages before this timestamp
- Convert dates: `date -d "2026-03-01" +%s` (Linux) or `date -j -f "%Y-%m-%d" "2026-03-01" +%s` (macOS)
- Inside the container (Linux): `date -d "7 days ago" +%s`

## Tips

- The bot can read any **public** channel after joining it
- For **private** channels, the bot must be explicitly invited by a member
- Messages include `user` field with user IDs (e.g., `U0AJHP26LS0`) — resolve with users.info
- Slack uses `mrkdwn` (not markdown) for formatting: `*bold*`, `_italic_`, `~strikethrough~`, `` `code` ``
- Rate limits: ~1 request/second for most endpoints. Add brief delays if hitting multiple channels
- Always check the `ok` field in responses — if `false`, check `error` field
