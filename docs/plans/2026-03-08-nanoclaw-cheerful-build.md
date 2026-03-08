# nanoclaw-cheerful Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a dedicated NanoClaw assistant for Cheerful campaign management, scoped per Slack channel to a single client's data, deployable as a standalone service on a new VPS.

**Architecture:** Fork `br0wnr1dg3/nanoclaw-assistant` as the base, strip non-Cheerful skills, add two new skills (`cheerful-supabase`, `cheerful-api`), configure the assistant name to "Cheerful AI", and set up a `@Cheerful setup <domain>` command that auto-provisions new client channels.

**Tech Stack:** Node.js 22, TypeScript, `@slack/bolt`, `better-sqlite3`, Claude Agent SDK, Supabase (Postgres), Cheerful backend API (`prd-cheerful.fly.dev`)

---

## Prerequisites (human steps — do before starting)

- [ ] Provision new Hetzner VPS (CX22, Ubuntu 24.04) — note the IP
- [ ] Confirm "Cheerful AI" Slack bot tokens: `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN`
- [ ] Have Cheerful Supabase service role key ready: project `cgtgotrffwukyuxdqcml`
- [ ] Have `ANTHROPIC_API_KEY` ready

---

## Task 1: Bootstrap repo from nanoclaw-assistant base

Copy the full nanoclaw-assistant codebase into this repo, then remove files specific to the personal assistant.

**Files:**
- Modify: repo root (copy from `br0wnr1dg3/nanoclaw-assistant`)

**Step 1: Copy base files from nanoclaw-assistant**

```bash
cd /tmp
git clone https://github.com/br0wnr1dg3/nanoclaw-assistant nanoclaw-base
cd nanoclaw-cheerful

# Copy all base files except git history
rsync -av --exclude='.git' /tmp/nanoclaw-base/ .

# Verify key files exist
ls src/ container/ skills-engine/ package.json tsconfig.json vitest.config.ts
```

**Step 2: Install dependencies**

```bash
npm install
```

Expected: clean install, no errors.

**Step 3: Verify build**

```bash
npm run build
```

Expected: `dist/` created, no TypeScript errors.

**Step 4: Run existing tests**

```bash
npm test
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: bootstrap from nanoclaw-assistant base"
```

---

## Task 2: Configure assistant identity

Set the assistant name to "Cheerful AI" and update the `.env.example`.

**Files:**
- Modify: `.env.example` (or create if not present)
- No code changes needed — name is configured via `ASSISTANT_NAME` env var

**Step 1: Create `.env.example`**

```bash
cat > .env.example << 'EOF'
# Slack — Cheerful AI bot
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...

# Assistant name (shown in Slack)
ASSISTANT_NAME=Cheerful AI

# Supabase — Cheerful project (cgtgotrffwukyuxdqcml)
SUPABASE_URL=https://cgtgotrffwukyuxdqcml.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...

# Cheerful backend
CHEERFUL_BACKEND_URL=https://prd-cheerful.fly.dev

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...
EOF
```

**Step 2: Update README title**

Edit `README.md` — replace the first heading with `# nanoclaw-cheerful` and add a one-liner: "Cheerful AI assistant for campaign management via Slack."

**Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "chore: configure Cheerful AI identity and env template"
```

---

## Task 3: Strip non-Cheerful skills

Remove skills that are irrelevant to Cheerful campaign management.

**Files:**
- Delete: `container/skills/google-workspace/`
- Delete: `container/skills/google-drive/`
- Delete: `container/skills/granola/`
- Delete: `container/skills/linear/`
- Delete: `container/skills/brainstorming/`
- Delete: `container/skills/executing-plans/`
- Delete: `container/skills/writing-plans/`
- Keep: `container/skills/slack-api/`
- Keep: `container/skills/scrapling/`
- Keep: `container/skills/agent-browser/`
- Keep: `container/skills/task-list/`

**Step 1: Remove unused skills**

```bash
cd container/skills
rm -rf google-workspace google-drive granola linear brainstorming executing-plans writing-plans
ls
# Should show: agent-browser  scrapling  slack-api  task-list
```

**Step 2: Verify build still passes**

```bash
npm run build && npm test
```

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove non-Cheerful skills from container"
```

---

## Task 4: Create `cheerful-supabase` skill

Teach the agent how to query and update Cheerful's Supabase database, always scoped by `client_id`.

**Files:**
- Create: `container/skills/cheerful-supabase/SKILL.md`

**Step 1: Write the skill doc**

```bash
mkdir -p container/skills/cheerful-supabase
```

Write `container/skills/cheerful-supabase/SKILL.md`:

````markdown
# Cheerful — Supabase Database Access

This skill gives you direct access to the Cheerful Supabase database for reads and writes.

## CRITICAL: Always scope by client

**Every query MUST filter by the client's ID** (found in your CLAUDE.md as `CLIENT_ID`).
Never access data belonging to other clients. If `SCOPE: global`, you may query across clients but must confirm with the user first.

## Setup (once per session)

```python
import urllib.request, urllib.parse, json, os

SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')

def supabase_get(table, params=''):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{params}"
    req = urllib.request.Request(url, headers={
        'apikey': SERVICE_KEY,
        'Authorization': f'Bearer {SERVICE_KEY}',
        'Content-Type': 'application/json'
    })
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def supabase_patch(table, match_params, body):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{match_params}"
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method='PATCH', headers={
        'apikey': SERVICE_KEY,
        'Authorization': f'Bearer {SERVICE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
    })
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())
```

## Key Tables & Schema

### `campaign`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| client_id | uuid | FK → client |
| name | text | |
| status | text | DRAFT, ACTIVE, COMPLETED |
| campaign_type | text | GIFTING, PAID_PROMOTION |

### `campaign_creator`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| campaign_id | uuid | FK → campaign |
| name | text | |
| email | text | |
| gifting_status | text | CONTACTED, PENDING_DETAILS, READY_TO_SHIP, ORDERED, DECLINED, SKIPPED, OPTED_OUT |
| shopify_order_id | text | null until order created |
| slack_approval_status | text | pending, processing, approved |
| gifting_address | text | freeform address string |
| source_gmail_thread_id | text | |

### `campaign_workflow`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| campaign_id | uuid | FK → campaign |
| name | text | e.g. "Shopify Order Drafting" |
| is_enabled | bool | |
| output_schema | jsonb | null = workflow broken |

### `campaign_workflow_execution`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| gmail_thread_state_id | uuid | |
| status | text | completed, schema_validation_failed, pending |
| output_data | jsonb | shipping address + line items |

## Common Queries

### List all campaigns for a client
```python
CLIENT_ID = "your-client-id-from-CLAUDE.md"
campaigns = supabase_get('campaign', f'client_id=eq.{CLIENT_ID}&select=id,name,status,campaign_type')
for c in campaigns:
    print(f"{c['name']} — {c['status']}")
```

### List creators by gifting status
```python
# First get campaign IDs for this client
campaigns = supabase_get('campaign', f'client_id=eq.{CLIENT_ID}&select=id')
campaign_ids = ','.join([c['id'] for c in campaigns])

creators = supabase_get('campaign_creator',
    f'campaign_id=in.({campaign_ids})&gifting_status=eq.READY_TO_SHIP&select=id,name,email,gifting_status,shopify_order_id')
```

### Update a creator's gifting status
```python
supabase_patch('campaign_creator',
    f'id=eq.{creator_id}',
    {'gifting_status': 'SKIPPED'})
```

### Find creators needing action (READY_TO_SHIP, no order)
```python
creators = supabase_get('campaign_creator',
    f'campaign_id=in.({campaign_ids})&gifting_status=eq.READY_TO_SHIP&shopify_order_id=is.null&select=id,name,email,gifting_status')
```

## Safe to write directly via Supabase

- `campaign_creator.gifting_status`
- `campaign_creator.slack_approval_status`
- `campaign_creator.gifting_address`

## Use `cheerful-api` skill instead for

- Creating Shopify orders (POST /api/v1/shopify/workflow-executions/{id}/orders)
- Triggering workflows
- Launching campaigns
````

**Step 2: Commit**

```bash
git add container/skills/cheerful-supabase/
git commit -m "feat: add cheerful-supabase skill"
```

---

## Task 5: Create `cheerful-api` skill

Teach the agent how to call the Cheerful backend API for operations that need business logic (order creation, workflow triggers).

**Files:**
- Create: `container/skills/cheerful-api/SKILL.md`

**Step 1: Write the skill doc**

```bash
mkdir -p container/skills/cheerful-api
```

Write `container/skills/cheerful-api/SKILL.md`:

````markdown
# Cheerful — Backend API

Use this skill for operations that must go through the Cheerful backend (order creation, workflow triggers). These endpoints enforce business logic that should not be bypassed.

## Base URL

```python
import os
BACKEND_URL = os.environ.get('CHEERFUL_BACKEND_URL', 'https://prd-cheerful.fly.dev')
SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
```

## Authentication

All endpoints require a Supabase user JWT. Obtain one via the admin API using the service role key:

```python
import urllib.request, json

def get_user_jwt(user_id: str) -> str:
    """Get a JWT for a specific Supabase user using the service role key."""
    url = f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}/tokens"
    req = urllib.request.Request(
        url,
        data=b'{}',
        method='POST',
        headers={
            'apikey': SERVICE_KEY,
            'Authorization': f'Bearer {SERVICE_KEY}',
            'Content-Type': 'application/json'
        }
    )
    with urllib.request.urlopen(req) as r:
        tokens = json.loads(r.read())
    return tokens['access_token']
```

To find a client's user ID, query the `auth.users` table or the `client_user` table in Supabase for the campaign owner.

## Create Shopify Order

Creates a Shopify draft order for a creator from their completed workflow execution.

**Prerequisite:** The creator must have a `campaign_workflow_execution` with `status='completed'` and `output_data` populated (email, shipping_address with `country_code`/`province_code`, line_items).

```python
def create_order(execution_id: str, user_jwt: str) -> dict:
    url = f"{BACKEND_URL}/api/v1/shopify/workflow-executions/{execution_id}/orders"
    req = urllib.request.Request(
        url,
        data=b'{}',
        method='POST',
        headers={
            'Authorization': f'Bearer {user_jwt}',
            'Content-Type': 'application/json'
        }
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

# Example
result = create_order('ec286204-5ded-4124-835b-1d5073751b96', jwt)
print(f"Order {result['order_name']} created: {result['order_id']}")
# Updates campaign_creator: gifting_status → ORDERED, shopify_order_id → set
```

**Response (HTTP 201):**
```json
{
  "order_id": "gid://shopify/Order/...",
  "order_name": "#687202",
  "total_amount": "49.00",
  "currency_code": "GBP",
  "workflow_execution_id": "..."
}
```

## Finding the Execution ID for a Creator

```python
# Get creator's source_gmail_thread_id first
creator = supabase_get('campaign_creator', f'id=eq.{creator_id}&select=source_gmail_thread_id')
thread_id = creator[0]['source_gmail_thread_id']

# Get thread states
states = supabase_get('gmail_thread_state', f'gmail_thread_id=eq.{thread_id}&select=id')
state_ids = ','.join([s['id'] for s in states])

# Get completed execution with output_data
executions = supabase_get('campaign_workflow_execution',
    f'gmail_thread_state_id=in.({state_ids})&status=eq.completed&output_data=not.is.null&select=id,output_data')
execution_id = executions[0]['id']
```

## Error Handling

```python
import urllib.error

try:
    result = create_order(execution_id, jwt)
except urllib.error.HTTPError as e:
    body = json.loads(e.read())
    print(f"API error {e.code}: {body}")
    # 404 = execution not found
    # 422 = output_data missing or malformed
    # 401 = invalid JWT
```
````

**Step 2: Commit**

```bash
git add container/skills/cheerful-api/
git commit -m "feat: add cheerful-api skill"
```

---

## Task 6: Pass Cheerful env vars into containers

The agent running in each container needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `CHEERFUL_BACKEND_URL`. These must be synced from the host `.env` to the container env.

**Files:**
- Read: `src/container-runner.ts` — find how env vars are passed to containers
- Modify: wherever the container env file is written

**Step 1: Read container-runner to understand env sync**

```bash
grep -n "env" src/container-runner.ts | head -30
grep -n "SUPABASE\|env/" src/container-runner.ts | head -20
```

**Step 2: Add Cheerful vars to the env sync allowlist**

Find the section in `container-runner.ts` (or `src/env.ts`) where env vars are passed to containers. Add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `CHEERFUL_BACKEND_URL` to the list of vars synced to `data/env/env`.

The pattern will look something like:
```typescript
const CONTAINER_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  // add:
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CHEERFUL_BACKEND_URL',
];
```

**Step 3: Build and test**

```bash
npm run build && npm test
```

**Step 4: Commit**

```bash
git add src/
git commit -m "feat: pass Cheerful env vars into agent containers"
```

---

## Task 7: Set up global `#cheerful-ai` CLAUDE.md

Create the memory file for the internal global-scope channel.

**Files:**
- Create: `groups/cheerful-ai/CLAUDE.md`

**Step 1: Create directory and file**

```bash
mkdir -p groups/cheerful-ai
```

Write `groups/cheerful-ai/CLAUDE.md`:

```markdown
# Cheerful AI — Internal

You are Cheerful AI, an assistant for managing Cheerful influencer marketing campaigns.

## Scope
SCOPE: global

## Rules
- You have access to ALL clients' data
- ALWAYS confirm which client you are acting on before making any writes
- When acting on a specific client, state the CLIENT_NAME and CLIENT_ID before proceeding
- Use the `cheerful-supabase` skill for database reads and direct writes
- Use the `cheerful-api` skill for: creating Shopify orders, triggering workflows

## Capabilities
- Query campaigns, creators, orders across all clients
- Update creator gifting status
- Create Shopify orders for creators
- Surface creators needing action
- Answer questions about campaign performance

## Out of scope
- No code changes to the Cheerful codebase
- No email sending or Gmail management
```

**Step 2: Commit**

```bash
git add groups/cheerful-ai/
git commit -m "feat: add cheerful-ai global scope CLAUDE.md"
```

---

## Task 8: Build the `@Cheerful setup <domain>` command

When the bot is mentioned with `setup <domain>` in an unregistered channel, it should look up the client in Supabase, create the channel's CLAUDE.md, register the group, and post a welcome message.

This logic lives in the global CLAUDE.md as instructions the agent follows — no code changes required.

**Files:**
- Modify: `groups/cheerful-ai/CLAUDE.md` — add setup instructions
- Create: `groups/global/CLAUDE.md` — fallback for unregistered channels

**Step 1: Update `groups/cheerful-ai/CLAUDE.md` with setup instructions**

Add a `## Setup Command` section:

```markdown
## Setup Command

When a user in any channel says `setup <domain>` (e.g. `setup spacegoods.com`):

1. Query Supabase `client` table for a record matching that domain:
   ```python
   clients = supabase_get('client', f'domain=eq.{domain}&select=id,name,domain')
   ```

2. If no match: reply "No client found for `{domain}`. Check the domain and try again."

3. If match found:
   a. Determine the channel folder name from the current channel (it will be in your context)
   b. Create `groups/{channel-folder}/CLAUDE.md` with:
      ```
      # Cheerful AI — {CLIENT_NAME}

      You are Cheerful AI, an assistant for managing {CLIENT_NAME}'s Cheerful campaigns.

      ## Scope
      CLIENT_ID: {CLIENT_ID}
      CLIENT_NAME: {CLIENT_NAME}
      CLIENT_DOMAIN: {DOMAIN}
      SCOPE: client

      ## Rules
      - ONLY access data where campaign.client_id = {CLIENT_ID}
      - NEVER query, read or modify data belonging to other clients
      - Use cheerful-api skill for: creating Shopify orders, triggering workflows
      - Use cheerful-supabase skill for: all reads, status updates, creator management

      ## Capabilities
      - Query campaigns and creator status for {CLIENT_NAME}
      - Update creator gifting status
      - Create Shopify orders for creators
      - Surface creators needing action
      - Answer questions about campaign performance
      ```
   c. Register the group using `mcp__nanoclaw__register_group` with:
      - jid: current channel JID
      - name: {CLIENT_NAME}
      - folder: slack_{channel-name}
      - trigger: @Cheerful
   d. Post the welcome message (see below)

4. Welcome message format:
   ```
   ✅ *Cheerful AI is set up for {CLIENT_NAME}!*

   Here are some things you can ask me:

   • "List all creators ready to ship"
   • "Show me creators who haven't responded"
   • "Create an order for [creator name]"
   • "What's the status of [campaign name]?"
   • "Mark [creator name] as skipped"
   • "Show all ordered creators for [campaign name]"

   Just tag me with @Cheerful and ask away.
   ```
```

**Step 2: Create `groups/global/CLAUDE.md` for unregistered channels**

This is the fallback that runs before a channel is set up:

```markdown
# Cheerful AI

You are Cheerful AI. This channel is not yet configured.

If you are an admin, set up this channel by typing:
`@Cheerful setup <client-domain>`

For example: `@Cheerful setup spacegoods.com`
```

**Step 3: Commit**

```bash
git add groups/
git commit -m "feat: add setup command and welcome message to CLAUDE.md"
```

---

## Task 9: Update deployment docs

Write clear deployment instructions for setting up on a new VPS.

**Files:**
- Create: `docs/DEPLOY.md`

**Step 1: Write deploy doc**

Write `docs/DEPLOY.md`:

```markdown
# Deployment Guide

## Prerequisites

- Hetzner VPS (CX22, Ubuntu 24.04)
- Cheerful AI Slack bot tokens (SLACK_BOT_TOKEN, SLACK_APP_TOKEN)
- Cheerful Supabase service role key
- Anthropic API key

## First-time VPS Setup

```bash
# SSH into VPS
ssh root@<vps-ip>

# Create nanoclaw user
useradd -m -s /bin/bash nanoclaw
su - nanoclaw

# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Docker (for container runner)
sudo apt-get install -y docker.io
sudo usermod -aG docker nanoclaw

# Clone repo
git clone https://github.com/nuts-and-bolts-ai/nanoclaw-cheerful ~/nanoclaw-cheerful
cd ~/nanoclaw-cheerful
npm install
npm run build

# Build container image
./container/build.sh

# Create .env from template
cp .env.example .env
nano .env  # Fill in all values

# Set up systemd user service
mkdir -p ~/.config/systemd/user
cp launchd/nanoclaw.service ~/.config/systemd/user/nanoclaw-cheerful.service
# Edit the service file to point to ~/nanoclaw-cheerful
systemctl --user enable nanoclaw-cheerful
systemctl --user start nanoclaw-cheerful
systemctl --user status nanoclaw-cheerful
```

## Deploying Updates

```bash
git push origin main
ssh nanoclaw@<vps-ip> "cd ~/nanoclaw-cheerful && git pull && npm run build && systemctl --user restart nanoclaw-cheerful"
```

## If container skills changed (Dockerfile/agent-runner/container/skills):

```bash
ssh nanoclaw@<vps-ip> "cd ~/nanoclaw-cheerful && git pull && ./container/build.sh && npm run build && systemctl --user restart nanoclaw-cheerful"
```

## Registering the #cheerful-ai channel

After first deploy:
1. Invite the bot to `#cheerful-ai` in Slack
2. Type `@Cheerful AI` — the bot will auto-register the channel
3. The `groups/cheerful-ai/CLAUDE.md` already exists with global scope

## Adding a new client channel

1. Invite the bot to `#cheerful-<brand>` in Slack
2. Type `@Cheerful setup <client-domain>`
3. Bot will auto-configure and post a welcome message
```

**Step 2: Commit**

```bash
git add docs/DEPLOY.md
git commit -m "docs: add deployment guide"
```

---

## Task 10: Final build + smoke test checklist

**Step 1: Full build**

```bash
npm run build
```
Expected: no errors.

**Step 2: Run tests**

```bash
npm test
```
Expected: all pass.

**Step 3: Verify skill files exist**

```bash
ls container/skills/
# Expected: agent-browser  cheerful-api  cheerful-supabase  scrapling  slack-api  task-list
```

**Step 4: Verify group files exist**

```bash
ls groups/
# Expected: cheerful-ai  global  main
cat groups/cheerful-ai/CLAUDE.md | head -5
```

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: final build verification"
git push origin main
```

---

## Post-Deploy Smoke Tests (on VPS)

Once deployed to the new VPS:

1. **Bot responds**: Invite bot to `#cheerful-ai`, send `@Cheerful AI hello` — should respond
2. **Setup command**: Invite bot to a test channel, send `@Cheerful setup spacegoods.com` — should create CLAUDE.md and post welcome message
3. **Scoped query**: In the Spacegoods channel, ask "list all campaigns" — should only return Spacegoods campaigns
4. **Cross-client guard**: Ask "show me absolute collagen campaigns" — should refuse
5. **Global access**: In `#cheerful-ai`, ask "show campaigns for all clients" — should work
