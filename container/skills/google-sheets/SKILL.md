---
name: google-sheets
description: Read and update Google Sheets via API — search by value, read/write scattered cells, discover sheet structure. Use when the user shares a Google Sheets URL, asks to update a spreadsheet or tracking sheet, or references cells/rows in a sheet.
---

# Google Sheets API

Read and update cells in Google Sheets via the Sheets API v4 using a service account.

## Auth

Get an access token (cached for 1 hour):

```bash
SKILL_DIR="$(find /home/node/.claude/skills -name sheets-auth.sh -path '*/google-sheets/*' | head -1)"
TOKEN=$("$SKILL_DIR")
```

Always run this before any API call. The token is cached automatically.

## Extracting Sheet ID

From a URL like `https://docs.google.com/spreadsheets/d/ABC123/edit#gid=0`, the sheet ID is `ABC123`.

```bash
SHEET_ID="ABC123"
```

If no URL is available, check the campaign config or ask the user.

## Discover Structure (Read Headers)

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Sheet1!1:1" | python3 -m json.tool
```

Returns: `{"range":"Sheet1!1:1","majorDimension":"ROWS","values":[["Name","Email","Status","Date",...]]}`

Use the header positions to determine column letters (A=0, B=1, ..., Z=25, AA=26, etc.).

## Search by Value (e.g., find a row by email)

1. Read headers to find which column has emails (e.g., column B).
2. Fetch the entire column:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Sheet1!B:B"
```

3. Find the matching row number in the returned values array. The array is 0-indexed, so index 0 = row 1, index 1 = row 2, etc.

## Read Scattered Cells

Read multiple non-adjacent cells in a single request:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet?ranges=Sheet1!K175&ranges=Sheet1!M200&ranges=Sheet1!A1"
```

Returns a `valueRanges` array with one entry per requested range.

## Read a Row

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Sheet1!A175:Z175"
```

## Write Scattered Cells

**IMPORTANT: Get user permission first (see Permission Rules below).**

```bash
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate" \
  -d '{
    "valueInputOption": "USER_ENTERED",
    "data": [
      {"range": "Sheet1!K175", "values": [["12/03/26"]]},
      {"range": "Sheet1!M200", "values": [["done"]]}
    ]
  }'
```

`USER_ENTERED` means Google Sheets parses the values as if typed by a user (dates, numbers, formulas work naturally).

## Verify After Write

After writing, read back the cells to confirm:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet?ranges=Sheet1!K175&ranges=Sheet1!M200"
```

Report results to the user:
- **Match:** "K175: confirmed '12/03/26'"
- **Mismatch:** "K175: expected '12/03/26' but found '12/3/2026' — Google Sheets auto-formatted"

## Permission Rules

**Reading:** Go ahead freely. No confirmation needed.

**Writing:** Before executing ANY writes, you MUST:
1. List every proposed change with cell reference and new value
2. Show the user a clear summary, e.g.:
   ```
   I'd like to update the following cells:
   - K175: → "12/03/26"
   - K176: → "15/03/26"
   Shall I go ahead?
   ```
3. Wait for explicit confirmation before writing anything
4. Never write to a sheet without permission, even for "small" changes

## Column Letter Helper

To convert a 0-based column index to a letter:
- 0→A, 1→B, ..., 25→Z, 26→AA, 27→AB, ...

```bash
# Convert column index to letter(s) — e.g., col_letter 0 → A, col_letter 27 → AB
col_letter() {
  local n=$1 result=""
  while true; do
    result=$(printf "\\$(printf '%03o' $((n % 26 + 65)))")${result}
    n=$((n / 26 - 1))
    [[ $n -lt 0 ]] && break
  done
  echo "$result"
}
```

## Handling Multiple Sheets/Tabs

If the spreadsheet has multiple tabs, first get metadata:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties.title"
```

Then use the tab name in range references: `TabName!A1:Z1` instead of `Sheet1!A1:Z1`.

## Error Handling

- **403 Forbidden**: The sheet isn't shared with the service account email. Ask the user to share it with the email from the service account JSON.
- **404 Not Found**: Wrong sheet ID or the sheet was deleted.
- **400 Bad Request**: Usually a malformed range. Check the range syntax.
