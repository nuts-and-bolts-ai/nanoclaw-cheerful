# Google Sheets Skill Design

## Overview

A standalone agent skill (`container/skills/google-sheets/SKILL.md`) that gives the agent reliable techniques for reading and writing Google Sheets via browser automation. Builds on the existing `agent-browser` tool — no new tools, APIs, or env vars required.

## Key Decisions

- **Standalone skill** — separate from `cheerful-api` and `agent-browser` since it's a distinct domain
- **Read freely, write with permission** — agent can read any cell without asking, but must present a summary of all proposed writes and get explicit user confirmation before executing
- **Single-cell navigation** — uses the Name Box technique to jump to specific cells; no range selection
- **Always verify after writing** — re-reads every written cell and reports mismatches (catches silent failures and auto-formatting)
- **No container rebuild needed** — skills sync at runtime

## Trigger

Activates when the user shares a Google Sheets URL, mentions updating a spreadsheet/tracking sheet, or references cells/rows in a sheet. Description tuned to win over generic `agent-browser` for Sheets-related tasks.

## Core Technique: Cell Navigation via Name Box

1. Snapshot the page to find the "Name Box" input (near top-left, adjacent to "Name Box menu button" landmark)
2. Click the Name Box
3. Type the cell reference (e.g., "K175"), press Enter
4. Sheet jumps to that cell

## Core Technique: Writing with F2 Edit Mode

The `/` character triggers Google Sheets' help/search shortcut when a cell is in command mode. The fix:

1. Navigate to cell via Name Box
2. Press **F2** to enter edit mode (critical — makes `/` a literal character)
3. Select all (Ctrl+A) and delete to clear existing content
4. Type value character by character using `agent-browser type`
5. Press Enter to commit

This is essential for dates (e.g., "12/03/26") and any value containing forward slashes.

## Permission Model

- **Reading:** No confirmation needed. Agent reads freely.
- **Writing:** Before any writes, agent presents a summary:
  ```
  I'd like to update the following cells:
  - K175: "" → "12/03/26"
  - K176: "" → "15/03/26"
  Shall I go ahead?
  ```
  Waits for explicit user confirmation before executing.

## Verification

After every write batch, the agent:
1. Re-navigates to each written cell
2. Reads the current value
3. Compares against intended value
4. Reports: confirmed matches and flagged mismatches (common cause: Sheets auto-formatting)

## Skill Structure (SKILL.md sections)

1. **Quick start** — minimal open/read/write example
2. **Permission rules** — read freely, write only after summary + confirmation
3. **Cell navigation** — Name Box technique with step-by-step agent-browser commands
4. **Reading cells** — navigate + read from formula bar or active cell
5. **Writing cells** — F2 edit mode technique, character-by-character
6. **The `/` character** — explicit callout on why F2 is mandatory for slashes
7. **Handling dialogs** — dismissing anonymous edit prompts and popups
8. **Verification** — always re-read after writing, report mismatches

## Out of Scope (YAGNI)

- Range selection
- Formula editing
- Cell formatting
- Sheet creation
- Multi-tab navigation

## Deployment

Skills-only change — no container rebuild:
```bash
git push origin main
# Follow standard deploy from CLAUDE.md
```
