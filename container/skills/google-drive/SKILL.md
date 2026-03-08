---
name: google-drive
description: Search, list, read, and download files from Google Drive. Supports multiple accounts (nutsandbolts, flixr). Use whenever the user asks about files, documents, or Drive content.
---

# Google Drive Access via rclone

Rclone is pre-installed and configured with multiple Google Drive accounts.

## Setup (once per session)

Rclone config is mounted at `/workspace/extra/rclone-config/`. Point rclone to it:

```bash
export RCLONE_CONFIG=/workspace/extra/rclone-config/rclone.conf
```

Run this before any rclone command.

## Available Drives

| Remote | Account |
|--------|---------|
| `nutsandbolts:` | Nuts & Bolts AI |
| `flixr:` | Flixr |

## Search for Files

```bash
# Search across a specific drive
rclone lsf nutsandbolts: --recursive --include "*quarterly*" | head -20

# Search by file type
rclone lsf flixr: --recursive --include "*.pdf" | head -20

# Search with path filter
rclone lsf nutsandbolts:"Project Folder" --recursive --include "*report*"
```

## List Folders

```bash
# Top-level folders
rclone lsd nutsandbolts:

# Contents of a specific folder
rclone lsf nutsandbolts:"Folder Name" --max-depth 1

# With details (size, date)
rclone lsl nutsandbolts:"Folder Name" --max-depth 1
```

## Read a File

```bash
# Download to workspace (persists between sessions)
rclone copy nutsandbolts:"path/to/file.pdf" /workspace/group/downloads/

# Read a text file directly
rclone cat nutsandbolts:"path/to/notes.txt"

# Read a Google Doc as plain text
rclone cat nutsandbolts:"path/to/document.gdoc" --drive-export-formats txt

# Read a Google Sheet as CSV
rclone cat nutsandbolts:"path/to/spreadsheet.gsheet" --drive-export-formats csv
```

## Download Multiple Files

```bash
# Download a whole folder
rclone copy nutsandbolts:"Reports/Q4" /workspace/group/downloads/q4-reports/

# Download matching files
rclone copy nutsandbolts: /workspace/group/downloads/ --include "*.pdf" --max-depth 2
```

## Search Across All Drives

```bash
# Search all configured drives for a file
for remote in nutsandbolts flixr; do
  echo "=== $remote ==="
  rclone lsf "$remote:" --recursive --include "*search-term*" | head -10
done
```

## Create / Upload Files

**IMPORTANT:** Never create `.gdoc`, `.gsheet`, or `.gslides` files. These are Google's internal link formats and cannot be opened. Instead, create standard Office files and let rclone convert them to native Google formats on upload.

```bash
# Create a Google Doc: write a .docx file, then upload with import
# Use any method to create the .docx (e.g. pandoc, python-docx, or plain text)
echo "Document content here" > /tmp/doc.txt
pandoc /tmp/doc.txt -o /tmp/document.docx  # if pandoc available
# Or just write plain text and use txt import:
rclone copyto /tmp/doc.txt nutsandbolts:"path/to/My Document.txt" --drive-import-formats docx

# Upload a .docx and convert to native Google Doc
rclone copyto /tmp/document.docx nutsandbolts:"path/to/My Document.docx" --drive-import-formats docx

# Upload a .csv or .xlsx and convert to native Google Sheet
rclone copyto /tmp/data.csv nutsandbolts:"path/to/My Spreadsheet.csv" --drive-import-formats csv

# Upload without conversion (keeps original format)
rclone copyto /tmp/report.pdf nutsandbolts:"path/to/report.pdf"
```

### Supported import conversions

| Upload format | Converts to |
|--------------|-------------|
| `.docx`, `.txt`, `.html`, `.md` | Google Doc |
| `.csv`, `.xlsx`, `.tsv` | Google Sheet |
| `.pptx` | Google Slides |

**Key flags:**
- `--drive-import-formats` — converts uploaded files to native Google format
- `copyto` (not `copy`) — uploads a single file to an exact path
- `copy` — uploads file(s) into a directory

## Tips

- Always set `RCLONE_CONFIG` first — the default location doesn't exist in the container
- Use `lsf` (flat list) instead of `ls` for easier parsing
- Add `| head -20` to prevent huge outputs on large drives
- Google Docs/Sheets/Slides are exported on download — use `--drive-export-formats` to control format
- Files downloaded to `/workspace/group/` persist between sessions
- The config is mounted read-only — you cannot add or modify Drive accounts from the container
