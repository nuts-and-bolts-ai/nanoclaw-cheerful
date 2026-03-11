---
name: creator-search
description: Search for Instagram and TikTok creators/influencers by keyword or similar handle, create lists, and add creators to lists. ALWAYS use this skill for creator discovery — never scrape social media profiles manually.
---

# Creator Search

Use the Cheerful creator search API for ALL creator/influencer discovery. **Never scrape Instagram, TikTok, or any social media directly** — the API provides richer data (profile pics, follower counts, engagement rates) and is much faster.

## Setup (once per session)

```python
import urllib.request, urllib.error, json, os

BACKEND_URL = os.environ.get('CHEERFUL_BACKEND_URL', 'https://prd-cheerful.fly.dev')
SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
ADMIN_EMAIL = 'chris@nutsandbolts.ai'

def get_user_jwt(email: str) -> str:
    """Generate a JWT for a Supabase user via admin magic link + verify."""
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

## Search by Keyword

Search for creators by topic, niche, or description keywords.

```
POST /api/v1/creator-search/keyword
```

```python
def search_keyword(keyword: str, platform: str = 'instagram',
                   followers_min=None, followers_max=None,
                   location=None) -> dict:
    jwt = get_user_jwt(ADMIN_EMAIL)
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
        headers={'Authorization': f'Bearer {jwt}', 'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())
```

**Response fields per creator:**
```json
{
  "id": "uc_44668036",
  "username": "mamazestblog",
  "full_name": "Motherhood & Lifestyle",
  "profile_pic_url": "https://...",
  "follower_count": 8342,
  "is_verified": false,
  "biography": null,
  "email": null,
  "engagement_rate": 0.581
}
```

## Search by Similar Handle

Find creators similar to a given handle — useful for "find more like this" requests.

```
POST /api/v1/creator-search/similar
```

```python
def search_similar(handle: str, platform: str = 'instagram',
                   followers_min=None, followers_max=None,
                   location=None) -> dict:
    jwt = get_user_jwt(ADMIN_EMAIL)
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
        headers={'Authorization': f'Bearer {jwt}', 'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())
```

## Platform & Search Tips

- **`platform`**: Use `"instagram"` or `"tiktok"`. Default is `"instagram"`.
- **Keywords**: Combine niche + demographic + location for best results (e.g. `"wellness mum UK"` not just `"wellness"`)
- **Multiple keywords**: Run separate searches per keyword and merge results to get variety (e.g. search "mom", "wellness", "nutrition" separately)
- **Location**: Pass as array of country/region names: `["United Kingdom"]`, `["United States"]`
- **Followers**: Use `followers_min`/`followers_max` to filter by size. For micro-influencers: `max=50000`. For nano: `max=10000`.
- **Email enrichment**: Not needed during initial search — emails can be enriched later when adding to a campaign. Don't waste time trying to find emails.

## Create a List

```python
def create_list(title: str) -> dict:
    jwt = get_user_jwt(ADMIN_EMAIL)
    req = urllib.request.Request(
        f'{BACKEND_URL}/api/v1/lists/',
        data=json.dumps({'title': title}).encode(),
        method='POST',
        headers={'Authorization': f'Bearer {jwt}', 'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())
```

## Add Creators from Search to List

Pass the search results directly — include `avatar_url` so profile pictures show in the UI.

```python
def add_creators_to_list(list_id: str, creators: list) -> dict:
    jwt = get_user_jwt(ADMIN_EMAIL)
    req = urllib.request.Request(
        f'{BACKEND_URL}/api/v1/lists/{list_id}/creators/from-search',
        data=json.dumps({'creators': creators}).encode(),
        method='POST',
        headers={'Authorization': f'Bearer {jwt}', 'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

# Map search results to the format expected by this endpoint:
creators_to_add = [
    {
        'platform': 'instagram',
        'handle': c['username'],
        'name': c.get('full_name'),
        'follower_count': c.get('follower_count', 0),
        'avatar_url': c.get('profile_pic_url'),  # backend expects avatar_url
    }
    for c in search_results['creators']
]
```

## List All Lists

```python
def get_all_lists() -> dict:
    jwt = get_user_jwt(ADMIN_EMAIL)
    req = urllib.request.Request(
        f'{BACKEND_URL}/api/v1/lists/',
        headers={'Authorization': f'Bearer {jwt}'}
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())
```

## Get Creators in a List

```python
def get_list_creators(list_id: str) -> dict:
    jwt = get_user_jwt(ADMIN_EMAIL)
    req = urllib.request.Request(
        f'{BACKEND_URL}/api/v1/lists/{list_id}/creators',
        headers={'Authorization': f'Bearer {jwt}'}
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())
```

## Full Workflow Example

```python
# 1. Search for creators by keyword
results = search_keyword('wellness mum', platform='instagram',
                         followers_max=50000, location=['United Kingdom'])
print(f"Found {results['total']} creators")

# 2. Create a list
new_list = create_list('UK Wellness Micro-Influencers - March 2026')
list_id = new_list['id']

# 3. Add search results to the list (include avatar_url!)
creators_to_add = [
    {
        'platform': 'instagram',
        'handle': c['username'],
        'name': c.get('full_name'),
        'follower_count': c.get('follower_count', 0),
        'avatar_url': c.get('profile_pic_url'),  # backend expects avatar_url
    }
    for c in results['creators']
]
result = add_creators_to_list(list_id, creators_to_add)
print(f"Added {result['added_count']}, skipped {result['skipped_count']}")
```

## Deduplication

When the user says "make sure they don't already exist in another list or campaign":

1. Fetch existing lists with `get_all_lists()`
2. For each list, fetch creators with `get_list_creators(list_id)`
3. Collect all existing handles into a set
4. Filter search results to exclude existing handles before adding to the new list

## Error Handling

```python
try:
    results = search_keyword('wellness', platform='instagram')
except urllib.error.HTTPError as e:
    body = json.loads(e.read())
    if e.code == 401:
        print("JWT expired — regenerate token")
    elif e.code == 422:
        print(f"Invalid request: {body.get('detail', body)}")
    else:
        print(f"API error {e.code}: {body}")
```
