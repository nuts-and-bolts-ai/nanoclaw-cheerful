---
name: task-list
description: Maintain a running to-do list. Use when updating, reviewing, or briefing on tasks. Automatically used by morning/evening scheduled runs.
---

# Task List

You maintain a running to-do list at `/workspace/group/tasks.md`. This is Chris's single source of truth for what needs doing.

## File Format

```markdown
## Active

- [ ] Reply to Dave's email about Q2 budget (source: Gmail, added Mar 5)
- [ ] Review PR #42 on nanoclaw (source: Linear, added Mar 5)

## Deferred

- [ ] Research new CRM options (deferred until Apr)

## Completed

- [x] Send invoice to client (completed Mar 4)
```

Tasks are markdown checkboxes with source and date. Keep Active ordered by urgency (most urgent first).

## Morning/Evening Scan Routine

When triggered by a scheduled task, run this routine:

### 1. Scan Sources

**Gmail** — check unread/flagged across all accounts:
```bash
for acct in brownridges nutsandbolts challenger-gray flixr; do
  GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=/workspace/extra/gws-accounts/$acct.json \
    gws gmail users messages list --params "{\"userId\":\"me\",\"q\":\"is:unread newer_than:1d\",\"maxResults\":10}"
done
```
Look for: emails needing replies, action items, deadlines mentioned.

**Slack** — check recent mentions and key channels:
```bash
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  'https://slack.com/api/conversations.history?channel=CHANNEL_ID&limit=20'
```
Look for: direct mentions, questions asked of Chris, action items.

**Linear** — check open/updated issues:
```bash
curl -s -H "Authorization: $LINEAR_API_KEY" -H "Content-Type: application/json" \
  -d '{"query":"{ issueSearch(query: \"assignee:me\", first: 20) { nodes { id identifier title state { name } priority dueDate updatedAt } } }"}' \
  https://api.linear.app/graphql
```
Look for: overdue issues, new assignments, recently updated items.

**Conversation history** — read recent conversations:
```bash
ls /workspace/group/conversations/ | tail -5
```
Look for: commitments Chris made ("I'll do X", "remind me to Y", "need to Z").

### 2. Update tasks.md

- Read the current `/workspace/group/tasks.md`
- **Add** new tasks found from scanning (include source and today's date)
- **Complete** tasks where evidence shows they're done (email replied, issue closed, etc.)
- **Don't delete** tasks Chris added manually — only he removes tasks
- If unsure whether something is a task, prefix with `?`: `- [ ] ? Possibly follow up with Dave re: contract`
- Prune completed tasks older than 7 days

### 3. Send Briefing

Send to both WhatsApp and Slack using `mcp__nanoclaw__send_message`.

**Morning briefing format:**
```
*Morning Briefing*

_X active tasks, Y new since yesterday, Z overdue_

*Urgent/Overdue:*
• [task] — overdue by 3 days
• [task] — due today

*New:*
• [task] (source: Gmail)
• [task] (source: Linear)

*Full active list: X items*
[brief summary or top 5 if list is long]
```

**Evening briefing format:**
```
*End of Day*

_Completed today: X | Still open: Y | New today: Z_

*Done today:*
• [task]
• [task]

*Still open:*
• [top items or summary]

*Anything new that came in:*
• [items added since morning]
```

Use WhatsApp formatting: single *bold*, _italic_, bullet points (•). No markdown headings (##).

## During Normal Conversations

- If Chris says "I handled X", "done with Y", or similar — mark it complete in tasks.md
- If Chris mentions a new task or commitment — add it to Active
- If Chris asks "what's on my list?" or "tasks" — read tasks.md and summarize
- If Chris says "defer X" — move it to Deferred with a note
- If Chris says "remove X" or "delete X" — remove it from the list
