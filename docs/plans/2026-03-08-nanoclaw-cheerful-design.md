# nanoclaw-cheerful — Design Document
*2026-03-08*

## Overview

A dedicated NanoClaw assistant for Cheerful campaign management. Built on the `nanoclaw-assistant` framework, deployed as a standalone service on its own VPS, with Slack as the interface. Scoped per client — each Slack channel maps to a single Cheerful client, so users can only access and manage the data belonging to that client.

Internal team gets a global-scope channel (`#cheerful-ai`) with access across all clients.

---

## Architecture

```
Slack Channels                       nanoclaw-cheerful (dedicated VPS)

#cheerful-spacegoods      ──────►    groups/cheerful-spacegoods/CLAUDE.md
#cheerful-abs-collagen    ──────►    groups/cheerful-absolute-collagen/CLAUDE.md  ──► Container Agent
#cheerful-ai              ──────►    groups/cheerful-ai/CLAUDE.md                        │
                                                                                          │
                                     Skills:                                              │
                                     ├── cheerful-supabase   ◄── Supabase (service role key, cgtgotrffwukyuxdqcml)
                                     ├── cheerful-api        ◄── prd-cheerful.fly.dev
                                     ├── slack-api           ◄── Slack API
                                     ├── scrapling           ◄── Web scraping
                                     ├── agent-browser       ◄── Browser automation
                                     └── task-list           ◄── Task tracking
```

**Key principles:**
- Completely separate from the personal nanoclaw instance — different VPS, different Slack bot, different credentials
- Client scoping enforced at the prompt level via `CLAUDE.md` per channel
- `#cheerful-ai` is the only global-scope channel — internal team only
- No code changes — full campaign management only (campaigns, creators, orders, workflows)

---

## Scoping Model

### Per-channel CLAUDE.md

Every Slack channel gets its own isolated `groups/{channel-name}/CLAUDE.md` containing:

**Client channel:**
```markdown
# Cheerful AI — Spacegoods

## Scope
CLIENT_ID: d0ef2052-9d54-46a5-8521-5ffbba529edd
CLIENT_NAME: Spacegoods
CLIENT_DOMAIN: spacegoods.com
SCOPE: client

## Rules
- ONLY access data where the client_id matches CLIENT_ID above
- NEVER query, read or modify data belonging to other clients
- If asked about another client, refuse politely
- Use cheerful-api skill for: creating orders, triggering workflows, launching campaigns
- Use cheerful-supabase skill for: all reads, status updates, creator management

## Context
[Client-specific context added at setup time]
```

**Internal channel:**
```markdown
# Cheerful AI — Internal

## Scope
SCOPE: global

## Rules
- Can access all clients
- Always confirm which client you are acting on before making any writes
- Prefer to specify CLIENT_ID explicitly in all queries
```

### Access control
- Channel membership = access gate. Anyone in `#cheerful-spacegoods` gets Spacegoods access.
- No further user-level verification — Slack channel membership is the security boundary.
- `#cheerful-ai` is restricted to the internal team via Slack channel permissions.

---

## Channel Setup Flow

New client channels are set up via a single command — no manual file editing required.

**Steps:**
1. Admin invites the Cheerful AI bot to the new Slack channel (e.g. `#cheerful-spacegoods`)
2. Admin types: `@Cheerful setup spacegoods.com`
3. Bot queries Supabase `client` table for a record matching that domain
4. On match: writes `groups/cheerful-spacegoods/CLAUDE.md` with the client's ID, name, domain, and default rules
5. Registers the group via `mcp__nanoclaw__register_group`
6. Replies: *"✅ Set up for Spacegoods (d0ef2052...). Ready to use."*
7. On no match: *"No client found for spacegoods.com. Check the domain and try again."*

`#cheerful-ai` is a special case — set up manually at deploy time with `SCOPE: global`.

---

## Skills

### `cheerful-supabase`
Direct Supabase access using the service role key.

**Covers:**
- Full DB schema documentation (key tables, relationships, enum values)
- How to scope all queries by `client_id`
- Which tables are safe to write directly (e.g. `campaign_creator.gifting_status`, `campaign_creator.slack_approval_status`)
- Example queries for common operations (list creators, check order status, update gifting status)

**Key tables:**
```
client
campaign (→ client)
campaign_creator (→ campaign)
campaign_workflow (→ campaign)
campaign_workflow_execution (→ campaign_workflow, gmail_thread_state)
gmail_thread_state (→ campaign_creator)
```

### `cheerful-api`
Calls to `prd-cheerful.fly.dev` backend.

**Covers:**
- Auth: how to obtain a user JWT via Supabase admin API
- Create Shopify order: `POST /api/v1/shopify/workflow-executions/{id}/orders`
- Trigger workflows: relevant endpoints
- Launch campaigns: relevant endpoints
- Error handling and retry patterns

### `slack-api`
Read Slack channel history, post messages. Used for reading gifting digest messages, checking approval status, posting updates.

### `scrapling` + `agent-browser`
Web scraping and browser automation. Used for checking creator social profiles, looking up brand info, ad library research for clients.

### `task-list`
Multi-step operation tracking for complex management tasks.

---

## Deployment

**Infrastructure:**
- New Hetzner VPS (CX22, Ubuntu 24.04) — completely separate from personal nanoclaw
- Systemd user service: `nanoclaw-cheerful.service`
- Separate Slack app and bot token
- Separate `.env` with Cheerful-specific credentials only

**Environment variables:**
```
SLACK_BOT_TOKEN=xoxb-...          # Cheerful AI Slack bot token
SLACK_APP_TOKEN=xapp-...          # Cheerful AI Slack app token
SUPABASE_URL=https://cgtgotrffwukyuxdqcml.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...     # Cheerful Supabase service role key
CHEERFUL_BACKEND_URL=https://prd-cheerful.fly.dev
ANTHROPIC_API_KEY=...
```

**Deploy command:**
```bash
git push origin main
ssh nanoclaw@[cheerful-vps-ip] "cd ~/nanoclaw-cheerful && git pull && npm run build && systemctl --user restart nanoclaw-cheerful"
```

---

## Capabilities (v1)

What the assistant can do in any client-scoped channel:

**Campaigns**
- List all campaigns for the client
- Show campaign status and creator breakdown
- Launch a new campaign (via API)

**Creators**
- List creators by gifting status
- Update gifting status (e.g. mark as SKIPPED, ORDERED)
- Show creator details (address, email, workflow status)

**Orders**
- Create a Shopify order for a creator (via API)
- Check order status
- List all pending/ready-to-ship creators

**Workflows**
- Check workflow execution status
- Trigger a workflow re-run
- Show broken/failed executions

**General**
- Answer questions about campaign performance
- Surface creators needing action
- Run ad-hoc Supabase queries scoped to the client

---

## Out of Scope (v1)

- Code changes to the Cheerful codebase
- Cross-client reporting (global scope only, in `#cheerful-ai`)
- Email sending or Gmail integration
- Billing / invoicing

---

## Open Questions

- [ ] Which Hetzner region for the new VPS? (Same as current — EU preferred)
- [ ] Slack workspace — same workspace as current nanoclaw, or client gets their own?
- [ ] Bot name/persona in Slack — "Cheerful AI"?
- [ ] Should the setup command also post a welcome message with example commands?
- [ ] Rate limiting — should the assistant refuse requests from non-registered channels gracefully?

---

## Repo Structure

```
nanoclaw-cheerful/
├── [forked from nanoclaw-assistant base]
├── container/
│   └── skills/
│       ├── cheerful-supabase/    ← new
│       ├── cheerful-api/         ← new
│       ├── slack-api/            ← kept
│       ├── scrapling/            ← kept
│       ├── agent-browser/        ← kept
│       └── task-list/            ← kept
├── docs/
│   └── plans/
│       └── 2026-03-08-nanoclaw-cheerful-design.md  ← this file
└── groups/
    └── cheerful-ai/
        └── CLAUDE.md             ← global scope, set up at deploy time
```

---

## Next Steps

1. Fork `nanoclaw-assistant` into this repo as the base
2. Create new Slack app for Cheerful AI
3. Provision new Hetzner VPS
4. Build `cheerful-supabase` and `cheerful-api` skills
5. Set up `groups/cheerful-ai/` with global CLAUDE.md
6. Deploy and test with `#cheerful-ai` channel
7. Register first client channel (`#cheerful-spacegoods`) via setup command
8. Iterate on skills based on real usage
