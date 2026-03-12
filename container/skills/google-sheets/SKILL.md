---
name: google-sheets
description: Read and update Google Sheets — navigate to cells, read values, and write updates with verification. Use when the user shares a Google Sheets URL, asks to update a spreadsheet or tracking sheet, or references cells/rows in a sheet. Builds on agent-browser for Sheets-specific navigation patterns.
allowed-tools: Bash(agent-browser:*)
---

# Google Sheets

Read and update cells in Google Sheets via browser automation.

## Quick Start

```bash
# Open a sheet
agent-browser open "https://docs.google.com/spreadsheets/d/SHEET_ID/edit"

# Read a cell
# 1. Snapshot to find the Name Box
agent-browser snapshot -i
# 2. Click the Name Box (look for the input near "Name Box menu button")
agent-browser click @REF
# 3. Type the cell reference and press Enter
agent-browser fill @REF "K175"
agent-browser press Enter
# 4. Read the value from the formula bar or active cell
agent-browser snapshot -i
agent-browser get text @REF  # formula bar content

# Write a cell (after getting user permission — see Permission Rules)
# 1. Navigate to the cell (same as above)
# 2. Press F2 to enter edit mode
agent-browser press F2
# 3. Select all and delete existing content
agent-browser press Control+a
agent-browser press Backspace
# 4. Type the new value
agent-browser type @REF "12/03/26"
# 5. Press Enter to commit
agent-browser press Enter
```

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

## Cell Navigation (Name Box Technique)

The Name Box is the input field in the top-left corner of Google Sheets that shows the current cell reference (e.g., "A1"). Use it to jump directly to any cell.

1. Take a snapshot to find the Name Box:
   ```bash
   agent-browser snapshot -i
   ```
   Look for an input element near the "Name Box menu button" landmark. The Name Box displays the current cell reference.

2. Click the Name Box to select it:
   ```bash
   agent-browser click @REF  # the Name Box input
   ```

3. Type the target cell reference and press Enter:
   ```bash
   agent-browser fill @REF "K175"
   agent-browser press Enter
   ```

4. The sheet scrolls to and selects the target cell.

**Finding the Name Box after page changes:** If refs become stale after navigation or dialog dismissal, re-snapshot. The Name Box is always near the top-left, adjacent to the "Name Box menu button" element.

## Reading Cells

After navigating to a cell:

1. Snapshot to get current page elements:
   ```bash
   agent-browser snapshot -i
   ```

2. Read the formula bar content (shows the raw cell value):
   ```bash
   agent-browser get text @REF  # the formula bar element
   ```

To read multiple cells, repeat the navigation + read cycle for each cell.

## Writing Cells

**IMPORTANT: Get user permission first (see Permission Rules above).**

For each cell to write:

1. **Navigate** to the cell via Name Box (see Cell Navigation above)

2. **Press F2** to enter edit mode:
   ```bash
   agent-browser press F2
   ```
   This is CRITICAL. Without F2, the cell is in command mode where certain characters (especially `/`) trigger Google Sheets shortcuts instead of being typed as literal characters.

3. **Clear** existing content:
   ```bash
   agent-browser press Control+a
   agent-browser press Backspace
   ```

4. **Type** the new value:
   ```bash
   agent-browser type @REF "12/03/26"
   ```
   Use `type` (not `fill`) to input characters naturally into the cell editor.

5. **Commit** by pressing Enter:
   ```bash
   agent-browser press Enter
   ```

After writing all cells, **always verify** (see Verification below).

## The `/` Character

The forward slash `/` triggers Google Sheets' help/search menu when typed in command mode. This breaks date entry (e.g., "12/03/26") and any value containing `/`.

**The fix:** Always press F2 before typing. F2 switches from command mode to edit mode, where `/` is treated as a literal character.

Never skip the F2 step when writing values — even if the value doesn't appear to contain special characters, F2 is a safe default.

## Handling Dialogs

Google Sheets may show dialogs that block interaction:

- **Anonymous edit dialog** ("Editors who can view your name and photo..."): Dismiss by clicking "Got it" or the close button. Re-snapshot after dismissal to get fresh element refs.
- **"View only" banner**: The sheet may not be editable. Inform the user rather than trying to force edits.

After dismissing any dialog, always re-snapshot before continuing — element refs from before the dialog are stale.

## Verification

After every write batch, verify each cell:

1. Navigate to the cell via Name Box
2. Read the current value from the formula bar
3. Compare against the intended value

Report results:
- **Match:** "K175: confirmed '12/03/26'"
- **Mismatch:** "K175: expected '12/03/26' but found '12/3/2026' — Google Sheets may have auto-formatted the date"

Common auto-formatting issues:
- Dates reformatted (e.g., "12/03/26" → "12/3/2026" or "2026-03-12")
- Numbers with leading zeros stripped (e.g., "007" → "7")
- Text interpreted as formulas (values starting with `=`)

If a mismatch is found, report it to the user and ask how to proceed.
