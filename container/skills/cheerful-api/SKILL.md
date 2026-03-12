---
name: cheerful-api
description: Call the Cheerful backend API for Shopify order creation, outbound outreach, and workflow triggers. Use when the user asks to create gifting orders, add creators to campaigns for outreach, or trigger backend workflows. For creator search and list management, use the creator-search skill instead.
---

# Cheerful — Backend API

Use this skill for operations that must go through the Cheerful backend (order creation, outbound outreach, workflow triggers). These endpoints enforce business logic, queue population, and Shopify integration that should not be bypassed via direct DB writes.

## Setup (once per session)

```python
import urllib.request, json, os

BACKEND_URL = os.environ.get('CHEERFUL_BACKEND_URL', 'https://prd-cheerful.fly.dev')
SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
```

## Authentication

All endpoints require a Supabase user JWT. Use the admin generate_link + verify flow to get one:

```python
def get_user_jwt(email: str) -> str:
    """Generate a JWT for a Supabase user via admin magic link + verify."""
    # Step 1: Generate a magic link (gives us an OTP)
    url = f"{SUPABASE_URL}/auth/v1/admin/generate_link"
    req = urllib.request.Request(
        url,
        data=json.dumps({'type': 'magiclink', 'email': email}).encode(),
        method='POST',
        headers={
            'apikey': SERVICE_KEY,
            'Authorization': f'Bearer {SERVICE_KEY}',
            'Content-Type': 'application/json'
        }
    )
    with urllib.request.urlopen(req) as r:
        link_data = json.loads(r.read())
    otp = link_data['email_otp']

    # Step 2: Verify the OTP to get an access token
    verify_url = f"{SUPABASE_URL}/auth/v1/verify"
    req = urllib.request.Request(
        verify_url,
        data=json.dumps({'type': 'magiclink', 'token': otp, 'email': email}).encode(),
        method='POST',
        headers={
            'apikey': SERVICE_KEY,
            'Content-Type': 'application/json'
        }
    )
    with urllib.request.urlopen(req) as r:
        tokens = json.loads(r.read())
    return tokens['access_token']
```

### Which user to authenticate as

Use the campaign owner's email — the order must be created under their account. Resolve from CLIENT_IDS in your CLAUDE.md if needed.

```python
def get_user_email(user_id: str) -> str:
    url = f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}"
    req = urllib.request.Request(url, headers={
        'apikey': SERVICE_KEY,
        'Authorization': f'Bearer {SERVICE_KEY}',
    })
    with urllib.request.urlopen(req) as r:
        user = json.loads(r.read())
    return user['email']
```

## List Shopify Products

Look up all active Shopify products for a campaign's store. Uses the GoAffPro store proxy (same source as the frontend UI). Useful when you need to find a product ID or variant ID by name.

```python
def list_shopify_products(campaign_id: str) -> list:
    """Fetch all active Shopify products for a campaign's connected store.

    Returns list of dicts: {id, name, handle, vendor, product_type, variations: [{id, name, price, sku}]}
    """
    # Step 1: Get the GoAffPro API key from campaign_workflow config
    url = f"{SUPABASE_URL}/rest/v1/campaign_workflow?campaign_id=eq.{campaign_id}&select=config"
    req = urllib.request.Request(url, headers={
        'apikey': SERVICE_KEY,
        'Authorization': f'Bearer {SERVICE_KEY}',
    })
    with urllib.request.urlopen(req) as r:
        workflows = json.loads(r.read())

    api_key = None
    for w in workflows:
        if w.get('config') and w['config'].get('goaffpro_api_key'):
            api_key = w['config']['goaffpro_api_key']
            break
    if not api_key:
        raise ValueError(f"No goaffpro_api_key found in campaign_workflow config for campaign {campaign_id}")

    # Step 2: Fetch products via GoAffPro store proxy (Shopify GraphQL)
    PROXY_URL = 'https://api.goaffpro.com/v1/admin/store/system/api'
    PAGE_SIZE = 50
    MAX_PAGES = 20

    all_products = []
    cursor = None
    has_next = True
    page = 0

    while has_next and page < MAX_PAGES:
        after = f', after: "{cursor}"' if cursor else ''
        query = '''{
          products(first: %d, query: "status:active"%s) {
            edges {
              node { id title handle vendor productType
                variants(first: 20) { edges { node { id title price sku } } }
              }
              cursor
            }
            pageInfo { hasNextPage endCursor }
          }
        }''' % (PAGE_SIZE, after)

        req = urllib.request.Request(
            PROXY_URL,
            data=json.dumps({'method': 'POST', 'url': '/graphql.json', 'body': {'query': query}}).encode(),
            method='POST',
            headers={
                'x-goaffpro-access-token': api_key,
                'Content-Type': 'application/json',
            }
        )
        with urllib.request.urlopen(req) as r:
            data = json.loads(r.read())

        edges = data['result']['data']['products']['edges']
        page_info = data['result']['data']['products']['pageInfo']

        for edge in edges:
            node = edge['node']
            numeric_id = node['id'].split('/')[-1]  # gid://shopify/Product/123 -> 123
            all_products.append({
                'id': numeric_id,
                'name': node['title'],
                'handle': node['handle'],
                'vendor': node['vendor'],
                'product_type': node.get('productType', ''),
                'variations': [
                    {
                        'id': ve['node']['id'].split('/')[-1],
                        'name': ve['node']['title'],
                        'price': ve['node']['price'],
                        'sku': ve['node'].get('sku', ''),
                    }
                    for ve in node['variants']['edges']
                ],
            })

        has_next = page_info['hasNextPage']
        cursor = page_info.get('endCursor')
        page += 1

    return all_products

# Example: find a product by name
products = list_shopify_products('your-campaign-uuid')
for p in products:
    if 'essential blend' in p['name'].lower():
        print(f"{p['name']} — Product ID: {p['id']}")
        for v in p['variations']:
            print(f"  Variant: {v['name']} — ID: {v['id']} — £{v['price']}")
```

## Create Shopify Order

Creates a Shopify order for a creator from their completed workflow execution. After success, automatically updates `campaign_creator`: `gifting_status → ORDERED`, `shopify_order_id → set`, `slack_approval_status → approved`.

**Prerequisite:** The creator must have a `campaign_workflow_execution` with `status='completed'` and `output_data` populated. Use the `cheerful-supabase` skill's `get_order_execution()` helper to find the execution ID.

```python
def create_order(execution_id: str, user_email: str) -> dict:
    """Create a Shopify order for a creator from their workflow execution."""
    jwt = get_user_jwt(user_email)

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

# Example usage — use campaign owner's email (resolve from CLIENT_IDS if needed)
result = create_order('ec286204-5ded-4124-835b-1d5073751b96', 'dan.stevenson@spacegoods.com')
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
def create_orders_for_ready_creators(campaign_id: str, owner_email: str) -> list:
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
            order = create_order(execution['id'], owner_email)
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

## Outreach — Add Creators to Campaign

Use these functions to add creators to an existing active campaign. The backend automatically personalizes emails from the campaign's templates, populates the outbound queue (round-robin across configured senders), and sends via the Temporal worker. You do not need to trigger sending — it happens automatically.

### List Active Campaigns

Find active campaigns to resolve names to IDs. Uses Supabase directly (no JWT needed).

```python
def list_active_campaigns() -> list:
    """Return active campaigns scoped to CLIENT_IDS."""
    client_ids = os.environ.get('CLIENT_IDS', '')
    url = f"{SUPABASE_URL}/rest/v1/campaign?status=eq.ACTIVE&user_id=in.({client_ids})&select=id,name,created_at&order=created_at.desc"
    req = urllib.request.Request(url, headers={
        'apikey': SERVICE_KEY,
        'Authorization': f'Bearer {SERVICE_KEY}',
    })
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

# Example: find campaign by name
campaigns = list_active_campaigns()
for c in campaigns:
    print(f"{c['name']} — {c['id']}")
```

### Add Recipients by Email

Use when you have the creator's email address. Creates `CampaignRecipient` records and populates the outbound queue.

```python
def add_recipients_to_campaign(campaign_id: str, recipients: list, user_email: str) -> list:
    """Add recipients to a campaign by email. Triggers outbound queue population.

    recipients: list of dicts with keys:
        - email (required): creator's email address
        - name (optional): creator's name
        - custom_fields (optional): dict of personalization fields for email templates
    """
    jwt = get_user_jwt(user_email)
    url = f"{BACKEND_URL}/api/v1/campaigns/{campaign_id}/recipients"
    req = urllib.request.Request(
        url,
        data=json.dumps(recipients).encode(),
        method='POST',
        headers={
            'Authorization': f'Bearer {jwt}',
            'Content-Type': 'application/json'
        }
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

# Example: add a single creator
result = add_recipients_to_campaign(
    campaign_id='a1b2c3d4-...',
    recipients=[
        {'email': 'creator@example.com', 'name': 'Jane Smith', 'custom_fields': {'brand': 'Acme'}}
    ],
    user_email='dan.stevenson@spacegoods.com'
)
print(f"Added {len(result)} recipients — emails will be sent automatically")
```

**Success response (HTTP 201):** Returns list of newly created recipients (duplicates are skipped silently):
```json
[
  {
    "id": "uuid",
    "campaign_id": "uuid",
    "email": "creator@example.com",
    "name": "Jane Smith",
    "custom_fields": {"brand": "Acme"},
    "created_at": "2026-03-09T..."
  }
]
```

### Add Creators from Search Results

Use when you have social media handles (from the creator-search skill). Creates both `CampaignRecipient` (for email queue) and `CampaignCreator` (for social metadata). Creators without email are queued for enrichment automatically.

```python
def add_creators_from_search(campaign_id: str, creators: list, user_email: str) -> list:
    """Add creators from search results to a campaign. Triggers outbound queue population.

    creators: list of dicts with keys:
        - email (optional): creator's email address
        - name (optional): creator's name
        - social_media_handles (required): list of {platform, handle, url (optional)}
        - custom_fields (optional): dict of personalization fields
    """
    jwt = get_user_jwt(user_email)
    url = f"{BACKEND_URL}/api/v1/campaigns/{campaign_id}/recipients-from-search"
    req = urllib.request.Request(
        url,
        data=json.dumps(creators).encode(),
        method='POST',
        headers={
            'Authorization': f'Bearer {jwt}',
            'Content-Type': 'application/json'
        }
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

# Example: add creators from search with social handles
result = add_creators_from_search(
    campaign_id='a1b2c3d4-...',
    creators=[
        {
            'email': 'creator@example.com',
            'name': 'Jane Smith',
            'social_media_handles': [
                {'platform': 'instagram', 'handle': 'janesmith', 'url': 'https://instagram.com/janesmith'}
            ],
            'custom_fields': {'brand': 'Acme'}
        },
        {
            'name': 'No Email Creator',
            'social_media_handles': [
                {'platform': 'tiktok', 'handle': 'noemail', 'url': 'https://tiktok.com/@noemail'}
            ]
        }
    ],
    user_email='dan.stevenson@spacegoods.com'
)
for r in result:
    status = 'queued for outreach' if r['queue_populated'] else 'pending email enrichment'
    if r['already_existed']:
        status = 'already in campaign'
    print(f"Creator {r['creator_id']}: {status}")
```

**Success response (HTTP 201):**
```json
[
  {
    "recipient_id": "uuid",
    "creator_id": "uuid",
    "email": "creator@example.com",
    "name": "Jane Smith",
    "queue_populated": true,
    "already_existed": false
  },
  {
    "recipient_id": null,
    "creator_id": "uuid",
    "email": null,
    "name": "No Email Creator",
    "queue_populated": false,
    "already_existed": false
  }
]
```

### Outreach Error Handling

Same pattern as order creation errors. Key cases:

- **404:** Campaign not found
- **422:** Validation error — campaign not active, invalid email format, or empty recipients list
- **401:** JWT expired — regenerate with `get_user_jwt()`

