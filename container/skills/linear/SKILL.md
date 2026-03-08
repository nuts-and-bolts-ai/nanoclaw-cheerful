---
name: linear
description: Create, read, update, and search Linear issues, comments, and projects. Use whenever the user mentions tickets, issues, tasks in Linear, or project management.
---

# Linear API

You have access to the Linear GraphQL API via `$LINEAR_API_KEY`. Use `curl` to make requests.

## Teams

| Team | Key | ID |
|------|-----|----|
| Nuts & Bolts | NUTS | eb22e173-b5dc-4a61-9cb7-bd1ee6dd4ee4 |
| Challenger Gray | CGC | 5a850b44-8c72-4f0d-bda5-49d8fd0151e1 |
| Commissions | CGCCOM | cafc6ce7-c541-41ab-a476-91016d35b950 |
| Liftoff | LIF | bc253df0-a2aa-4b49-bed3-81235cc59dc6 |
| Kast | KAS | b694b4dd-23e3-4548-9e62-eaf99e926618 |
| Amaze | AMA | 66f866c8-066e-4695-ac2b-3c6bd3042126 |
| Cheerful AI | CHEER | 02959258-a9d5-4724-81a0-4fda3c586d3c |
| Mysocial | MYS | 2c0b7c43-e5b6-453c-a354-e52759fbecd5 |
| Mediabodies | MED | 83f9f95a-0606-4d03-bb22-4955e7424b37 |
| Platform_Rebuild | PLA | 33f4e86f-05d9-497a-afbd-f96c9598f6d9 |
| Printful | PRI | 40870d17-3af8-4984-ae6b-f1fada2523c1 |

## Base Command

```bash
curl -s -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"YOUR_GRAPHQL_QUERY"}' \
  https://api.linear.app/graphql
```

## Common Operations

### List issues for a team
```bash
curl -s -H "Authorization: $LINEAR_API_KEY" -H "Content-Type: application/json" \
  -d '{"query":"{ team(id: \"TEAM_ID\") { issues(first: 20, orderBy: updatedAt, filter: { state: { type: { nin: [\"completed\", \"canceled\"] } } }) { nodes { id identifier title state { name } priority assignee { name } createdAt } } } }"}' \
  https://api.linear.app/graphql
```

### Search issues
```bash
curl -s -H "Authorization: $LINEAR_API_KEY" -H "Content-Type: application/json" \
  -d '{"query":"{ issueSearch(query: \"search terms\", first: 10) { nodes { id identifier title state { name } team { key } assignee { name } } } }"}' \
  https://api.linear.app/graphql
```

### Get issue details (with comments)
```bash
curl -s -H "Authorization: $LINEAR_API_KEY" -H "Content-Type: application/json" \
  -d '{"query":"{ issue(id: \"ISSUE_ID\") { id identifier title description state { name } priority assignee { name } labels { nodes { name } } comments { nodes { body createdAt user { name } } } } }"}' \
  https://api.linear.app/graphql
```

### Create an issue
```bash
curl -s -H "Authorization: $LINEAR_API_KEY" -H "Content-Type: application/json" \
  -d '{"query":"mutation { issueCreate(input: { teamId: \"TEAM_ID\", title: \"Issue title\", description: \"Description in markdown\", priority: 2 }) { success issue { id identifier url } } }"}' \
  https://api.linear.app/graphql
```

Priority values: 0 = No priority, 1 = Urgent, 2 = High, 3 = Medium, 4 = Low

### Create issue with labels
```bash
# First find label IDs
curl -s -H "Authorization: $LINEAR_API_KEY" -H "Content-Type: application/json" \
  -d '{"query":"{ team(id: \"TEAM_ID\") { labels { nodes { id name } } } }"}' \
  https://api.linear.app/graphql

# Then create with label IDs
curl -s -H "Authorization: $LINEAR_API_KEY" -H "Content-Type: application/json" \
  -d '{"query":"mutation { issueCreate(input: { teamId: \"TEAM_ID\", title: \"Title\", description: \"Desc\", labelIds: [\"LABEL_ID\"] }) { success issue { id identifier url } } }"}' \
  https://api.linear.app/graphql
```

### Add a comment to an issue
```bash
curl -s -H "Authorization: $LINEAR_API_KEY" -H "Content-Type: application/json" \
  -d '{"query":"mutation { commentCreate(input: { issueId: \"ISSUE_ID\", body: \"Comment text in markdown\" }) { success comment { id } } }"}' \
  https://api.linear.app/graphql
```

### Update an issue (status, assignee, priority)
```bash
# First get workflow states for the team
curl -s -H "Authorization: $LINEAR_API_KEY" -H "Content-Type: application/json" \
  -d '{"query":"{ team(id: \"TEAM_ID\") { states { nodes { id name type } } } }"}' \
  https://api.linear.app/graphql

# Update issue state
curl -s -H "Authorization: $LINEAR_API_KEY" -H "Content-Type: application/json" \
  -d '{"query":"mutation { issueUpdate(id: \"ISSUE_ID\", input: { stateId: \"STATE_ID\" }) { success issue { id identifier state { name } } } }"}' \
  https://api.linear.app/graphql
```

### List projects
```bash
curl -s -H "Authorization: $LINEAR_API_KEY" -H "Content-Type: application/json" \
  -d '{"query":"{ projects(first: 20, filter: { state: { eq: \"started\" } }) { nodes { id name state teams { nodes { key } } } } }"}' \
  https://api.linear.app/graphql
```

## "Todo" State IDs

Always create issues in the "Todo" state. Use the correct stateId for the team:

| Team | Key | Todo State ID |
|------|-----|---------------|
| Nuts & Bolts | NUTS | f9580415-477f-443d-b92d-64dfcfca35d1 |
| Challenger Gray | CGC | ade5be8d-9360-4169-9658-bb647b8565ea |
| Commissions | CGCCOM | bb57a6b1-8766-4489-983e-c0e970772a5d |
| Liftoff | LIF | 63073fa0-8854-4136-9a80-1cda9671a0af |
| Kast | KAS | 0ab27e6f-1dbb-45d6-82fe-6f26beedef69 |
| Amaze | AMA | 816fd0ee-bb63-4f37-864a-307acf7168d1 |
| Cheerful AI | CHEER | 207e9163-4869-47fc-a7f1-35b1be0e31af |
| Mysocial | MYS | 271423c0-ae7d-45df-9f63-600153c0f511 |
| Mediabodies | MED | 1d813108-d22e-4ae6-9fcc-c6e962ce23bf |
| Platform_Rebuild | PLA | 1dabde61-8a15-4aa4-b9f4-990b52e7c52a |
| Printful | PRI | 51978d74-6f3a-4731-b94d-4cf06dfd69a6 |

Example creating an issue in Todo state:
```bash
curl -s -H "Authorization: $LINEAR_API_KEY" -H "Content-Type: application/json" \
  -d '{"query":"mutation { issueCreate(input: { teamId: \"TEAM_ID\", title: \"Title\", description: \"Description\", stateId: \"TODO_STATE_ID\" }) { success issue { id identifier url } } }"}' \
  https://api.linear.app/graphql
```

## Ticket Structure

When creating issues, ALWAYS use this description format (markdown):

```
## Context
[Source of this ticket — who sent the email, when, key quotes or context that explain why this exists]

## Problem / Request
[Clear description of what needs to be done and why it matters]

## Expected Outcome
[Specific deliverables or acceptance criteria — what does "done" look like?]
```

- **Title:** Clear and actionable (e.g. "Update Q1 commission reports for Silverlining" not "Commission stuff")
- **Do NOT set priority** — that is handled during triage
- **Always set stateId** to the team's "Todo" state from the table above
- When the ticket originates from an email, include the sender, date, and relevant excerpts in the Context section

## Tips

- Always pipe output through `| python3 -m json.tool` for readability, or use `jq` if parsing
- Use `identifier` (e.g. `CGC-123`) when reporting issues to the user — it's the human-readable ID
- Include the `url` field when creating issues so you can share the link
- Descriptions and comments support markdown
- Filter out completed/canceled issues by default unless the user asks for them
