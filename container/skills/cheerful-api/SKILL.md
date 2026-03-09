---
name: cheerful-api
description: Call the Cheerful backend API for Shopify order creation and workflow triggers. Use when the user asks to create gifting orders or trigger backend workflows. For creator search and list management, use the creator-search skill instead.
---

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

- **Creator search & list operations**: Use the Cheerful admin email `chris@nutsandbolts.ai` — the Influencer Club API key is platform-level, not per-client.
- **Shopify order creation**: Use one of the CLIENT_IDS from your CLAUDE.md — the order must be created under the campaign owner's account.

```python
# For creator search operations
ADMIN_EMAIL = 'chris@nutsandbolts.ai'
admin_jwt = get_user_jwt(ADMIN_EMAIL)

# For order operations, get the user's email from CLIENT_IDS
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

