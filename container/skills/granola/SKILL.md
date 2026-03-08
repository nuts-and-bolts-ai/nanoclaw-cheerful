---
name: granola
description: Access meeting notes, transcripts, and action items from Granola. Use when the user asks about meetings, calls, what was discussed, action items, follow-ups, or meeting summaries.
---

# Granola Meeting Notes

Granola is connected as an MCP server. You have access to the following tools:

## Available MCP Tools

| Tool | When to Use |
|------|-------------|
| `mcp__granola__list_meetings` | List meetings in a time range (this week, last week, last 30 days, or custom date range) |
| `mcp__granola__get_meetings` | Get detailed notes, summary, and attendees for specific meeting IDs (max 10) |
| `mcp__granola__get_meeting_transcript` | Get the full verbatim transcript of a specific meeting |
| `mcp__granola__query_granola_meetings` | Natural language query across meeting notes — best for open-ended questions |
| `mcp__granola__search_meetings` | Search meetings by title, content, or participants |

## Usage Patterns

### "What meetings did I have today?"
Use `list_meetings` with `time_range: "custom"` and today's date.

### "What were the action items from my call with Guillaume?"
Use `query_granola_meetings` with a natural language query — it's the best tool for content questions.

### "What exactly did they say about the budget?"
Use `get_meeting_transcript` for exact quotes. First find the meeting ID with `list_meetings` or `search_meetings`.

### "Review today's calls and summarize key takeaways"
1. `list_meetings` to get today's meetings
2. `get_meetings` with the IDs to get summaries and notes
3. Optionally `get_meeting_transcript` for details

## Tips

- **Prefer `query_granola_meetings`** for open-ended questions about meeting content — it searches across all notes intelligently.
- **Use `list_meetings` + `get_meetings`** when you need structured data (attendees, dates, full notes).
- **Transcripts** are only available on paid Granola tiers.
- Meeting IDs are UUIDs — get them from `list_meetings` or `search_meetings` first.
