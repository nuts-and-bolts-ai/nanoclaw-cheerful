# Cheerful — Backend API

Use this skill for operations that must go through the Cheerful backend (order creation, workflow triggers). These endpoints enforce business logic and Shopify integration that should not be bypassed via direct DB writes.

## Setup (once per session)

```python
import urllib.request, json, os

BACKEND_URL = os.environ.get('CHEERFUL_BACKEND_URL', 'https://prd-cheerful.fly.dev')
SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
```

## Authentication

All endpoints require a Supabase user JWT. Use the Supabase admin API to generate one for the campaign owner:

```python
def get_user_jwt(user_id: str) -> str:
    """Generate a JWT for a Supabase user via the admin API."""
    url = f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}/tokens"
    req = urllib.request.Request(
        url,
        data=json.dumps({}).encode(),
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

### Finding the campaign owner's user ID

```python
# Query client_user table to find the owner for a given client_id
def get_client_owner_user_id(client_id: str) -> str:
    url = f"{SUPABASE_URL}/rest/v1/client_user?client_id=eq.{client_id}&select=user_id&limit=1"
    req = urllib.request.Request(url, headers={
        'apikey': SERVICE_KEY,
        'Authorization': f'Bearer {SERVICE_KEY}'
    })
    with urllib.request.urlopen(req) as r:
        results = json.loads(r.read())
    return results[0]['user_id'] if results else None
```

## Create Shopify Order

Creates a Shopify order for a creator from their completed workflow execution. After success, automatically updates `campaign_creator`: `gifting_status → ORDERED`, `shopify_order_id → set`, `slack_approval_status → approved`.

**Prerequisite:** The creator must have a `campaign_workflow_execution` with `status='completed'` and `output_data` populated. Use the `cheerful-supabase` skill's `get_order_execution()` helper to find the execution ID.

```python
def create_order(execution_id: str, client_id: str) -> dict:
    """Create a Shopify order for a creator from their workflow execution."""
    # Get a JWT for the campaign owner
    user_id = get_client_owner_user_id(client_id)
    jwt = get_user_jwt(user_id)

    url = f"{BACKEND_URL}/api/v1/shopify/workflow-executions/{execution_id}/orders"
    req = urllib.request.Request(
        url,
        data=json.dumps({}).encode(),
        method='POST',
        headers={
            'Authorization': f'Bearer {jwt}',
            'Content-Type': 'application/json'
        }
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

# Example usage
result = create_order('ec286204-5ded-4124-835b-1d5073751b96', CLIENT_ID)
print(f"Order {result['order_name']} created — ID: {result['order_id']}, Amount: {result['total_amount']} {result['currency_code']}")
```

**Success response (HTTP 201):**
```json
{
  "order_id": "gid://shopify/Order/6052407705783",
  "order_name": "#687202",
  "total_amount": "49.00",
  "currency_code": "GBP",
  "workflow_execution_id": "ec286204-..."
}
```

## Create Orders for Multiple Creators

```python
def create_orders_for_ready_creators(campaign_id: str, client_id: str) -> list:
    """Create Shopify orders for all READY_TO_SHIP creators with completed executions."""
    from cheerful_supabase import supabase_get, get_order_execution  # helpers from cheerful-supabase skill

    # Find all ready creators with no order yet
    creators = supabase_get('campaign_creator',
        f'campaign_id=eq.{campaign_id}&gifting_status=eq.READY_TO_SHIP&shopify_order_id=is.null&select=id,name,email')

    results = []
    for creator in creators:
        execution = get_order_execution(creator['id'])
        if not execution:
            results.append({'creator': creator['name'], 'status': 'skipped', 'reason': 'no completed execution'})
            continue
        try:
            order = create_order(execution['id'], client_id)
            results.append({'creator': creator['name'], 'status': 'success', 'order_name': order['order_name']})
        except Exception as e:
            results.append({'creator': creator['name'], 'status': 'error', 'reason': str(e)})

    return results
```

## Error Handling

```python
import urllib.error

try:
    result = create_order(execution_id, client_id)
except urllib.error.HTTPError as e:
    body = json.loads(e.read())
    if e.code == 404:
        print(f"Execution {execution_id} not found")
    elif e.code == 422:
        print(f"Order data invalid: {body.get('detail', body)}")
        # Usually means output_data is missing country_code/province_code
        # Check the execution's output_data.shipping_address fields
    elif e.code == 401:
        print("JWT expired or invalid — regenerate token")
    else:
        print(f"API error {e.code}: {body}")
```

## Common Error: shipping_address field names

The `output_data.shipping_address` must use `country_code` and `province_code` (not `country` and `province`).

UK province codes: `ENG` (England), `WLS` (Wales), `SCT` (Scotland), `NIR` (Northern Ireland)

If an order fails with 422, check and fix the execution's output_data:
```python
# Fix field names in output_data
from cheerful_supabase import supabase_get, supabase_patch

execution = supabase_get('campaign_workflow_execution', f'id=eq.{execution_id}&select=id,output_data')[0]
addr = execution['output_data']['shipping_address']

# Fix if needed
if 'country' in addr and 'country_code' not in addr:
    addr['country_code'] = addr.pop('country')
if 'province' in addr and 'province_code' not in addr:
    province_map = {'England': 'ENG', 'Wales': 'WLS', 'Scotland': 'SCT', 'Northern Ireland': 'NIR'}
    addr['province_code'] = province_map.get(addr.pop('province'), 'ENG')

execution['output_data']['shipping_address'] = addr
supabase_patch('campaign_workflow_execution', f'id=eq.{execution_id}',
    {'output_data': execution['output_data']})
```

## Creator Search — Similar

Find creators similar to a given handle. Useful for discovering influencers with a similar audience or content style.

```
POST /api/v1/creator-search/similar
```

**Request body:**
```json
{
  "handle": "laurpottsx",
  "platform": "instagram",
  "followers": {"min": null, "max": 50000},
  "location": ["United Kingdom"]
}
```

**Response:**
```json
{
  "creators": [
    {
      "id": "abc123",
      "username": "wellnesswithsophie",
      "full_name": "Sophie Taylor",
      "follower_count": 34200,
      "biography": "Wellness & lifestyle | UK based",
      "email": "sophie@example.com",
      "engagement_rate": 0.05
    }
  ],
  "total": 48,
  "has_more": true,
  "page": 1
}
```

```python
def search_similar_creators(handle: str, platform: str = 'instagram',
                            followers_min=None, followers_max=None,
                            location=None, client_id=None) -> dict:
    """Find creators similar to a given handle."""
    user_id = get_client_owner_user_id(client_id)
    jwt = get_user_jwt(user_id)

    body = {
        'handle': handle,
        'platform': platform,
        'followers': {'min': followers_min, 'max': followers_max},
    }
    if location:
        body['location'] = location

    req = urllib.request.Request(
        f'{BACKEND_URL}/api/v1/creator-search/similar',
        data=json.dumps(body).encode(),
        method='POST',
        headers={
            'Authorization': f'Bearer {jwt}',
            'Content-Type': 'application/json'
        }
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())
```

## Creator Search — Keyword

Search for creators by keyword (topic, niche, description).

```
POST /api/v1/creator-search/keyword
```

**Request body:**
```json
{
  "keyword": "wellness supplements UK",
  "platform": "instagram",
  "followers": {"min": null, "max": 50000},
  "location": ["United Kingdom"]
}
```

**Response:** Same format as similar search.

```python
def search_keyword_creators(keyword: str, platform: str = 'instagram',
                            followers_min=None, followers_max=None,
                            location=None, client_id=None) -> dict:
    """Search for creators by keyword."""
    user_id = get_client_owner_user_id(client_id)
    jwt = get_user_jwt(user_id)

    body = {
        'keyword': keyword,
        'platform': platform,
        'followers': {'min': followers_min, 'max': followers_max},
    }
    if location:
        body['location'] = location

    req = urllib.request.Request(
        f'{BACKEND_URL}/api/v1/creator-search/keyword',
        data=json.dumps(body).encode(),
        method='POST',
        headers={
            'Authorization': f'Bearer {jwt}',
            'Content-Type': 'application/json'
        }
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())
```

## Create a List

Create a new creator list for organizing search results.

```
POST /api/v1/lists/
```

**Request body:**
```json
{"title": "UK Wellness Micro-Influencers"}
```

**Response:**
```json
{
  "id": "uuid",
  "user_id": "uuid",
  "title": "UK Wellness Micro-Influencers",
  "created_at": "2026-03-08T12:00:00Z",
  "updated_at": "2026-03-08T12:00:00Z"
}
```

```python
def create_list(title: str, client_id: str) -> dict:
    """Create a new creator list."""
    user_id = get_client_owner_user_id(client_id)
    jwt = get_user_jwt(user_id)

    req = urllib.request.Request(
        f'{BACKEND_URL}/api/v1/lists/',
        data=json.dumps({'title': title}).encode(),
        method='POST',
        headers={
            'Authorization': f'Bearer {jwt}',
            'Content-Type': 'application/json'
        }
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())
```

## Add Creators from Search to List

Add creators (from search results) to an existing list.

```
POST /api/v1/lists/{list_id}/creators/from-search
```

**Request body:**
```json
{
  "creators": [
    {"platform": "instagram", "handle": "laurpottsx", "name": "Laura Potts", "follower_count": 22000},
    {"platform": "instagram", "handle": "wellnesswithsophie", "name": "Sophie Taylor", "follower_count": 34200}
  ]
}
```

**Response:**
```json
{"added_count": 2, "skipped_count": 0}
```

```python
def add_creators_to_list(list_id: str, creators: list, client_id: str) -> dict:
    """Add creators from search results to a list."""
    user_id = get_client_owner_user_id(client_id)
    jwt = get_user_jwt(user_id)

    req = urllib.request.Request(
        f'{BACKEND_URL}/api/v1/lists/{list_id}/creators/from-search',
        data=json.dumps({'creators': creators}).encode(),
        method='POST',
        headers={
            'Authorization': f'Bearer {jwt}',
            'Content-Type': 'application/json'
        }
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())
```

## List All Lists

```
GET /api/v1/lists/
```

**Response:**
```json
{"items": [{"id": "uuid", "title": "UK Wellness Micro-Influencers", "created_at": "..."}], "total": 1}
```

```python
def get_all_lists(client_id: str) -> dict:
    """Get all creator lists."""
    user_id = get_client_owner_user_id(client_id)
    jwt = get_user_jwt(user_id)

    req = urllib.request.Request(
        f'{BACKEND_URL}/api/v1/lists/',
        headers={
            'Authorization': f'Bearer {jwt}',
        }
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())
```

## Get Creators in a List

```
GET /api/v1/lists/{list_id}/creators
```

**Response:**
```json
{"items": [{"handle": "laurpottsx", "name": "Laura Potts", "follower_count": 22000, "platform": "instagram"}], "total": 2}
```

```python
def get_list_creators(list_id: str, client_id: str) -> dict:
    """Get all creators in a list."""
    user_id = get_client_owner_user_id(client_id)
    jwt = get_user_jwt(user_id)

    req = urllib.request.Request(
        f'{BACKEND_URL}/api/v1/lists/{list_id}/creators',
        headers={
            'Authorization': f'Bearer {jwt}',
        }
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())
```

## Full Workflow Example: Search, Create List, and Add Creators

Complete example: find creators similar to a handle, create a list, and add the results.

```python
import urllib.request, json, os

BACKEND_URL = os.environ.get('CHEERFUL_BACKEND_URL', 'https://prd-cheerful.fly.dev')
SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')

CLIENT_ID = 'your-client-id'

# Step 1: Search for similar creators
results = search_similar_creators(
    handle='laurpottsx',
    platform='instagram',
    followers_max=50000,
    location=['United Kingdom'],
    client_id=CLIENT_ID
)
print(f"Found {results['total']} similar creators")

# Step 2: Create a list
new_list = create_list('UK Wellness Micro-Influencers', CLIENT_ID)
list_id = new_list['id']
print(f"Created list: {new_list['title']} (ID: {list_id})")

# Step 3: Add search results to the list
creators_to_add = [
    {
        'platform': 'instagram',
        'handle': c['username'],
        'name': c['full_name'],
        'follower_count': c['follower_count']
    }
    for c in results['creators']
]
add_result = add_creators_to_list(list_id, creators_to_add, CLIENT_ID)
print(f"Added {add_result['added_count']} creators to list (skipped {add_result['skipped_count']})")

# Step 4: Verify — list creators in the list
list_creators = get_list_creators(list_id, CLIENT_ID)
for c in list_creators['items']:
    print(f"  - @{c['handle']} ({c['name']}) — {c['follower_count']} followers")
```

## Error Handling for Creator Search & Lists

```python
import urllib.error

try:
    results = search_similar_creators(handle='nonexistent', client_id=CLIENT_ID)
except urllib.error.HTTPError as e:
    body = json.loads(e.read())
    if e.code == 404:
        print("Handle not found or no similar creators")
    elif e.code == 401:
        print("JWT expired or invalid — regenerate token")
    elif e.code == 422:
        print(f"Invalid request: {body.get('detail', body)}")
    else:
        print(f"API error {e.code}: {body}")
```
