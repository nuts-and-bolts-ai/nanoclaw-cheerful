---
name: rollbar
description: Query the Rollbar API to list recent errors, get stack traces, and investigate occurrences. Use when asked to check errors, monitor issues, or investigate stack traces from Rollbar.
---

# Rollbar — Error Monitoring API

Query Rollbar for recent errors and full stack traces. Read-only access.

## Setup (once per session)

```python
import urllib.request, json, os

ROLLBAR_TOKEN = os.environ.get('ROLLBAR_READ_TOKEN', '')
ROLLBAR_API = 'https://api.rollbar.com/api/1'

def rollbar_get(path: str, params: str = '') -> dict:
    """GET request to Rollbar API."""
    url = f"{ROLLBAR_API}/{path}"
    if params:
        url += f"?{params}"
    req = urllib.request.Request(url, headers={
        'X-Rollbar-Access-Token': ROLLBAR_TOKEN,
    })
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())
```

## List Recent Errors

```python
def list_recent_errors(level: str = 'error', status: str = 'active', limit: int = 20) -> list:
    """List recent error items. level: debug|info|warning|error|critical. status: active|resolved|muted."""
    data = rollbar_get('items', f'level={level}&status={status}&limit={limit}')
    return data.get('result', {}).get('items', [])

# Example
errors = list_recent_errors()
for e in errors:
    print(f"#{e['counter']} [{e['level']}] {e['title']} — {e['total_occurrences']} occurrences, last: {e['last_occurrence_timestamp']}")
```

**Response fields per item:**
- `id` — internal Rollbar item ID (use for API calls)
- `counter` — human-readable item number (e.g. #42)
- `title` — error message summary
- `level` — error/warning/critical/etc.
- `total_occurrences` — lifetime count
- `last_occurrence_timestamp` — unix timestamp of latest occurrence
- `environment` — e.g. "production"
- `status` — active/resolved/muted

## Get Item Details

```python
def get_item(item_id: int) -> dict:
    """Get a single item by its Rollbar ID or counter number."""
    data = rollbar_get(f'item/{item_id}')
    return data.get('result', {})
```

## List Occurrences of an Item (Stack Traces)

This is where the full stack traces live. Each occurrence has the complete error context.

```python
def list_occurrences(item_id: int, limit: int = 5) -> list:
    """List recent occurrences of an item. Each occurrence has the full stack trace."""
    data = rollbar_get(f'item/{item_id}/instances', f'limit={limit}')
    return data.get('result', {}).get('instances', [])

# Example: get stack trace for most recent occurrence of item #42
item = get_item(42)
occurrences = list_occurrences(item['id'], limit=1)
if occurrences:
    occ = occurrences[0]
    body = occ.get('data', {}).get('body', {})
    trace = body.get('trace', {})
    if trace:
        print(f"Exception: {trace.get('exception', {}).get('class')} — {trace.get('exception', {}).get('message')}")
        for frame in trace.get('frames', [])[-5:]:
            print(f"  {frame.get('filename')}:{frame.get('lineno')} in {frame.get('method')}")
```

## Get a Single Occurrence

```python
def get_occurrence(instance_id: str) -> dict:
    """Get full details of a single occurrence including stack trace and request context."""
    data = rollbar_get(f'instance/{instance_id}')
    return data.get('result', {})
```

## Top Active Errors

```python
def top_active_errors(hours: int = 24) -> list:
    """Get top active items by occurrence count in the last N hours."""
    data = rollbar_get('reports/top_active_items', f'hours={hours}')
    return data.get('result', [])
```

## Parsing Stack Traces

Rollbar stores traces in `occurrence.data.body`. The structure varies by error type:

- **Single exception:** `body.trace.frames[]` + `body.trace.exception`
- **Chained exceptions:** `body.trace_chain[]`, each with `frames[]` + `exception`
- **Message (no trace):** `body.message.body`

```python
def print_stack_trace(occurrence: dict):
    """Print a readable stack trace from an occurrence."""
    body = occurrence.get('data', {}).get('body', {})

    traces = []
    if 'trace' in body:
        traces = [body['trace']]
    elif 'trace_chain' in body:
        traces = body['trace_chain']
    elif 'message' in body:
        print(f"Message: {body['message'].get('body', 'no message')}")
        return

    for trace in traces:
        exc = trace.get('exception', {})
        print(f"\n{exc.get('class', 'Unknown')}: {exc.get('message', 'no message')}")
        for frame in trace.get('frames', []):
            print(f"  {frame.get('filename', '?')}:{frame.get('lineno', '?')} in {frame.get('method', '?')}")
```
