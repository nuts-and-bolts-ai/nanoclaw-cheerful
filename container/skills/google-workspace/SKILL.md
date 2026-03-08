---
name: google-workspace
description: Access Gmail, Google Calendar, Drive, Docs, and Sheets across multiple accounts. Use when the user asks about email, calendar, meetings, scheduling, files, documents, spreadsheets, or Google Drive.
---

# Google Workspace via `gws` CLI

The `gws` (Google Workspace CLI) is installed globally. Credential files for each account are mounted at `/workspace/extra/gws-accounts/`.

## Available Accounts

| Account | Credential File |
|---------|----------------|
| Brownridges (chris@brownridges.com) | `/workspace/extra/gws-accounts/brownridges.json` |
| Nuts & Bolts (chris@nutsandbolts.ai) | `/workspace/extra/gws-accounts/nutsandbolts.json` |
| Challenger Gray (chris@getsilverlining.com) | `/workspace/extra/gws-accounts/challenger-gray.json` |
| Flixr (chris@flixrstudios.co) | `/workspace/extra/gws-accounts/flixr.json` |

## CLI Syntax

All `gws` commands follow the pattern:
```
gws <service> <resource> <method> --params '<JSON>' --json '<JSON>'
```

- `--params '<JSON>'` — URL/query parameters
- `--json '<JSON>'` — request body (for create/update operations)
- `--page-all` — auto-paginate through all results
- `--format table` — output as table (default is JSON)

Always prefix with the credential file:
```bash
GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/nutsandbolts.json \
  gws <service> ...
```

---

## Gmail

### List recent messages
```bash
GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/nutsandbolts.json \
  gws gmail users messages list --params '{"userId":"me","maxResults":10}'
```

### Search messages (Gmail query syntax)
```bash
GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/nutsandbolts.json \
  gws gmail users messages list --params '{"userId":"me","q":"from:someone@example.com after:2026/03/01","maxResults":20}'
```

Common query operators: `from:`, `to:`, `subject:`, `after:`, `before:`, `is:unread`, `has:attachment`, `in:inbox`, `label:`, `newer_than:2d`, `older_than:1w`

### Read a specific message
```bash
GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/nutsandbolts.json \
  gws gmail users messages get --params '{"userId":"me","id":"MESSAGE_ID","format":"full"}'
```

Use `"format":"metadata"` for headers only, or `"format":"full"` for complete message with body.

### Read a thread
```bash
GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/nutsandbolts.json \
  gws gmail users threads get --params '{"userId":"me","id":"THREAD_ID","format":"full"}'
```

### List labels
```bash
GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/nutsandbolts.json \
  gws gmail users labels list --params '{"userId":"me"}'
```

### Search across all accounts
```bash
for acct in brownridges nutsandbolts challenger-gray flixr; do
  echo "=== $acct ==="
  GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/$acct.json \
    gws gmail users messages list --params "{\"userId\":\"me\",\"q\":\"is:unread newer_than:1d\",\"maxResults\":10}"
done
```

### Send an email
```bash
# Build the raw RFC 2822 message, base64url-encode it, and send via Gmail API
RAW=$(printf 'From: chris@nutsandbolts.ai\r\nTo: recipient@example.com\r\nSubject: Meeting Follow-up\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nHey,\n\nJust following up on our meeting.\n\nBest,\nChris' | python3 -c "import sys,base64; print(base64.urlsafe_b64encode(sys.stdin.buffer.read()).decode())")

GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/nutsandbolts.json \
  gws gmail users messages send --params '{"userId":"me"}' --json "{\"raw\":\"$RAW\"}"
```

**IMPORTANT — email formatting rules:**
- Use the raw RFC 2822 + base64url approach above. Do NOT use escaped quotes or backslashes in the message body.
- For special characters (em dash —, apostrophes ', etc.), write them literally in the printf string. Do NOT escape them.
- The Subject line must be plain ASCII or properly MIME-encoded. Avoid special characters in subjects when possible.

### Reading message bodies
The Gmail API returns message bodies in base64url encoding inside `payload.parts` or `payload.body`. To decode:
```bash
# Get message and decode body
MSG=$(GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/nutsandbolts.json \
  gws gmail users messages get --params '{"userId":"me","id":"MESSAGE_ID","format":"full"}')
echo "$MSG" | python3 -c "
import json, sys, base64
msg = json.load(sys.stdin)
parts = msg.get('payload', {}).get('parts', [])
body = msg.get('payload', {}).get('body', {})
if body.get('data'):
    print(base64.urlsafe_b64decode(body['data']).decode())
for p in parts:
    if p.get('mimeType') == 'text/plain' and p.get('body', {}).get('data'):
        print(base64.urlsafe_b64decode(p['body']['data']).decode())
"
```

---

## Calendar

### Get today's events
```bash
GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/nutsandbolts.json \
  gws calendar events list --params "{\"calendarId\":\"primary\",\"timeMin\":\"$(date -u +%Y-%m-%dT00:00:00Z)\",\"timeMax\":\"$(date -u -d '+1 day' +%Y-%m-%dT00:00:00Z)\",\"singleEvents\":true,\"orderBy\":\"startTime\"}"
```

### Get events for a date range
```bash
GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/nutsandbolts.json \
  gws calendar events list --params '{"calendarId":"primary","timeMin":"2026-03-05T00:00:00Z","timeMax":"2026-03-12T00:00:00Z","singleEvents":true,"orderBy":"startTime"}'
```

### Get this week's events across all accounts
```bash
START=$(date -u +%Y-%m-%dT00:00:00Z)
END=$(date -u -d '+7 days' +%Y-%m-%dT00:00:00Z)

for acct in brownridges nutsandbolts challenger-gray flixr; do
  echo "=== $acct ==="
  GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/$acct.json \
    gws calendar events list --params "{\"calendarId\":\"primary\",\"timeMin\":\"$START\",\"timeMax\":\"$END\",\"singleEvents\":true,\"orderBy\":\"startTime\"}"
done
```

### Create an event (with attendees + Google Meet)
```bash
GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/nutsandbolts.json \
  gws calendar events insert \
  --params '{"calendarId":"primary","conferenceDataVersion":1}' \
  --json '{
    "summary": "Meeting Title",
    "description": "Meeting agenda and notes",
    "start": {"dateTime": "2026-03-10T14:00:00-08:00", "timeZone": "America/Los_Angeles"},
    "end": {"dateTime": "2026-03-10T15:00:00-08:00", "timeZone": "America/Los_Angeles"},
    "attendees": [
      {"email": "person@example.com"},
      {"email": "other@example.com"}
    ],
    "conferenceData": {
      "createRequest": {"requestId": "meet-'"$(date +%s)"'"}
    }
  }'
```

### Create an all-day event
```bash
GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/nutsandbolts.json \
  gws calendar events insert \
  --params '{"calendarId":"primary"}' \
  --json '{"summary": "Event Title", "start": {"date": "2026-03-10"}, "end": {"date": "2026-03-11"}}'
```

### Update an event
```bash
GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/nutsandbolts.json \
  gws calendar events patch \
  --params '{"calendarId":"primary","eventId":"EVENT_ID"}' \
  --json '{"summary": "Updated Title"}'
```

### Delete an event
```bash
GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/nutsandbolts.json \
  gws calendar events delete --params '{"calendarId":"primary","eventId":"EVENT_ID"}'
```

### Check free/busy across accounts
```bash
GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/nutsandbolts.json \
  gws calendar freebusy query --json '{
    "timeMin": "2026-03-10T00:00:00Z",
    "timeMax": "2026-03-10T23:59:59Z",
    "items": [
      {"id": "chris@nutsandbolts.ai"},
      {"id": "chris@getsilverlining.com"},
      {"id": "chris@flixrstudios.co"}
    ]
  }'
```

---

## Google Drive

### List files
```bash
GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/nutsandbolts.json \
  gws drive files list --params '{"pageSize":10,"fields":"files(id,name,mimeType,modifiedTime)"}'
```

### Search files
```bash
GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/nutsandbolts.json \
  gws drive files list --params '{"q":"name contains '\''report'\'' and mimeType='\''application/vnd.google-apps.document'\''","pageSize":10,"fields":"files(id,name,mimeType,modifiedTime)"}'
```

Common query operators: `name contains 'x'`, `mimeType = '...'`, `modifiedTime > '2026-03-01'`, `trashed = false`, `'FOLDER_ID' in parents`

### Get file metadata
```bash
GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/nutsandbolts.json \
  gws drive files get --params '{"fileId":"FILE_ID","fields":"id,name,mimeType,webViewLink,modifiedTime"}'
```

### Create a folder
```bash
GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/nutsandbolts.json \
  gws drive files create --json '{"name":"Folder Name","mimeType":"application/vnd.google-apps.folder"}'
```

---

## Google Docs

### Create a new document
```bash
GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/nutsandbolts.json \
  gws docs documents create --json '{"title":"Document Title"}'
```

### Get document content
```bash
GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/nutsandbolts.json \
  gws docs documents get --params '{"documentId":"DOC_ID"}'
```

### Update document content (insert text)
```bash
GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/nutsandbolts.json \
  gws docs documents batchUpdate \
  --params '{"documentId":"DOC_ID"}' \
  --json '{
    "requests": [
      {"insertText": {"location": {"index": 1}, "text": "Hello, world!\n"}}
    ]
  }'
```

---

## Google Sheets

### Get spreadsheet data
```bash
GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/nutsandbolts.json \
  gws sheets spreadsheets get --params '{"spreadsheetId":"SHEET_ID"}'
```

### Read a range
```bash
GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/nutsandbolts.json \
  gws sheets spreadsheets values get --params '{"spreadsheetId":"SHEET_ID","range":"Sheet1!A1:D10"}'
```

### Write to a range
```bash
GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/nutsandbolts.json \
  gws sheets spreadsheets values update \
  --params '{"spreadsheetId":"SHEET_ID","range":"Sheet1!A1","valueInputOption":"USER_ENTERED"}' \
  --json '{"values":[["Header1","Header2"],["Value1","Value2"]]}'
```

### Create a new spreadsheet
```bash
GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/nutsandbolts.json \
  gws sheets spreadsheets create --json '{"properties":{"title":"Spreadsheet Title"}}'
```

---

## Tips

- **Timezone:** Chris is in PST (America/Los_Angeles). Always use this timezone for event creation unless told otherwise.
- **Default account:** Use nutsandbolts unless the user specifies otherwise or the context clearly maps to another account.
- **calendarId:** Use `primary` for the main calendar of each account.
- **eventId:** Found in the `id` field of event list responses.
- **Attendees** automatically receive email invitations when added to calendar events.
- **Google Meet:** Add `conferenceData` in body + `conferenceDataVersion: 1` in params.
- **Google Docs:** Always create real Google Docs (not .gdoc or .txt files). Use `gws docs documents create` then `batchUpdate` to add content.
- Output is JSON — pipe through `python3 -m json.tool` or `jq` for readability.
- The credentials are mounted read-only — token refresh is handled automatically by `gws`.
