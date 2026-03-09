# Cheerful — Supabase Database Access

This skill gives you direct access to the Cheerful Supabase database for reads and writes.

## CRITICAL: Always scope by client

**Every query MUST filter by the client's user IDs** (found in your CLAUDE.md as `CLIENT_IDS`). A client may have multiple users (team members) — all their campaigns must be included.

- **Single user:** `user_id=eq.{id}`
- **Multiple users:** `user_id=in.({id1},{id2},{id3})`

Always use `in.(...)` syntax — it works for both single and multiple IDs.

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

def supabase_post(table, body):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method='POST', headers={
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
| user_id | uuid | FK → auth.users (campaign owner) |
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
| gifting_status | text | CONTACTED, UNRESPONSIVE, PENDING_DETAILS, READY_TO_SHIP, ORDERED, DECLINED, SKIPPED, OPTED_OUT |
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
| output_schema | jsonb | null = workflow broken (output_schema bug) |

### `campaign_workflow_execution`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| gmail_thread_state_id | uuid | FK → gmail_thread_state |
| workflow_id | uuid | FK → campaign_workflow |
| status | text | completed, schema_validation_failed, pending |
| output_data | jsonb | shipping address + line items (null = not yet collected) |

### `gmail_thread_state`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| gmail_thread_id | text | matches campaign_creator.source_gmail_thread_id |
| campaign_creator_id | uuid | FK → campaign_creator |

## Common Queries

### List all campaigns for a client
```python
# From CLAUDE.md CLIENT_IDS — always use in.() syntax
CLIENT_IDS = "id1,id2,id3"  # comma-separated from CLAUDE.md

campaigns = supabase_get('campaign', f'user_id=in.({CLIENT_IDS})&select=id,name,status,campaign_type&order=created_at.desc')
for c in campaigns:
    print(f"{c['name']} — {c['status']} ({c['campaign_type']})")
```

### List creators by gifting status for a campaign
```python
creators = supabase_get('campaign_creator',
    f'campaign_id=eq.{campaign_id}&gifting_status=eq.READY_TO_SHIP&select=id,name,email,gifting_status,shopify_order_id,gifting_address&order=name.asc')
for c in creators:
    print(f"{c['name']} ({c['email']}) — {c['gifting_status']}")
```

### Get all creators across all campaigns for a client
```python
# Get campaign IDs for this client first (use in.() with CLIENT_IDS)
campaigns = supabase_get('campaign', f'user_id=in.({CLIENT_IDS})&select=id,name')
campaign_ids = ','.join([c['id'] for c in campaigns])

creators = supabase_get('campaign_creator',
    f'campaign_id=in.({campaign_ids})&select=id,name,email,gifting_status,shopify_order_id,campaign_id&order=name.asc')
```

### Update a creator's gifting status
```python
updated = supabase_patch('campaign_creator',
    f'id=eq.{creator_id}',
    {'gifting_status': 'SKIPPED'})
print(f"Updated {updated[0]['name']} to SKIPPED")
```

### Find creators needing action (READY_TO_SHIP with no order)
```python
creators = supabase_get('campaign_creator',
    f'campaign_id=in.({campaign_ids})&gifting_status=eq.READY_TO_SHIP&shopify_order_id=is.null&select=id,name,email,gifting_address')
print(f"{len(creators)} creators need orders creating")
```

### Get creator's workflow execution (for order creation)
```python
def get_order_execution(creator_id: str) -> dict | None:
    """Find the completed workflow execution with output_data for a creator."""
    # Get gmail thread states for this creator
    states = supabase_get('gmail_thread_state', f'campaign_creator_id=eq.{creator_id}&select=id')
    if not states:
        return None
    state_ids = ','.join([s['id'] for s in states])

    # Find completed execution with output_data
    executions = supabase_get('campaign_workflow_execution',
        f'gmail_thread_state_id=in.({state_ids})&status=eq.completed&output_data=not.is.null&select=id,output_data&order=created_at.desc&limit=1')
    return executions[0] if executions else None
```

## Safe to write directly via Supabase
- `campaign_creator.gifting_status`
- `campaign_creator.slack_approval_status`
- `campaign_creator.gifting_address`
- `campaign_creator.notes`

## Use `cheerful-api` skill instead for
- Creating Shopify orders (requires backend business logic)
- Triggering or re-running workflows
- Launching new campaigns

## Error handling
```python
import urllib.error

try:
    results = supabase_get('campaign_creator', params)
except urllib.error.HTTPError as e:
    error_body = json.loads(e.read())
    print(f"Supabase error {e.code}: {error_body.get('message', 'unknown error')}")
except Exception as e:
    print(f"Request failed: {e}")
```
