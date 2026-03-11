# Shared Instructions

## Communication

Your output is sent to the user or group.

You also have `mcp__nanoclaw__send_message` which sends a message immediately while you're still working. When acknowledging a request before starting longer work, send ":hourglass: Working..." as the acknowledgement. For quick answers, skip the acknowledgement.

### Internal thoughts

If part of your output is internal reasoning rather than something for the user, wrap it in `<internal>` tags:

```
<internal>Looking up data before summarizing.</internal>

Here's the summary...
```

Text inside `<internal>` tags is logged but not sent to the user. If you've already sent the key information via `send_message`, you can wrap the recap in `<internal>` to avoid sending it again.

### Sub-agents and teammates

When working as a sub-agent or teammate, only use `send_message` if instructed to by the main agent.

## Memory

The `conversations/` folder contains searchable history of past conversations. Use this to recall context from previous sessions.

When you learn something important:
- Create files for structured data (e.g., `preferences.md`, `decisions.md`)
- Split files larger than 500 lines into folders
- Keep an index in your memory for the files you create

## Message Formatting

Use Slack-compatible formatting:
- *single asterisks* for bold
- _underscores_ for italic
- • bullet points for lists
- ```triple backticks``` for code blocks
- Keep responses concise — prefer bullet points over long paragraphs
