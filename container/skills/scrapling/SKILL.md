---
name: scrapling
description: Scrape and extract structured data from any website — handles anti-bot protection, JavaScript-rendered pages, and static HTML. Use whenever you need to pull data from a webpage.
---

# Web Scraping with Scrapling

## Setup (once per session)

```bash
pip install scrapling 2>/dev/null
```

If you need browser-based scraping (JavaScript-rendered pages, Cloudflare-protected sites):
```bash
scrapling install
```

## Which Fetcher to Use

| Fetcher | When to use | Speed |
|---------|-------------|-------|
| `Fetcher` | Static pages, APIs, simple HTML | Fast |
| `StealthyFetcher` | Anti-bot protection, Cloudflare, rate-limited sites | Slow |
| `DynamicFetcher` | JavaScript-rendered content, SPAs | Medium |

Start with `Fetcher`. Only escalate if you get blocked or content is missing.

## Quick Scrape

```python
from scrapling.fetchers import Fetcher

page = Fetcher.get('https://example.com')

# CSS selectors
title = page.css('h1::text').get()
all_links = page.css('a::attr(href)').getall()
paragraphs = page.css('p::text').getall()

# XPath
prices = page.xpath('//span[@class="price"]/text()').getall()
```

## Finding Elements

```python
# CSS selectors (preferred)
page.css('.class-name')                    # By class
page.css('#element-id')                    # By ID
page.css('div.card > h2::text').getall()   # Nested with text extraction
page.css('a::attr(href)').getall()         # Attribute extraction

# XPath
page.xpath('//table//tr/td/text()').getall()

# BeautifulSoup-style
page.find_all('div', class_='product')
page.find_all('a', {'href': True})
page.find_by_text('Price', tag='span')
```

## Extracting Data

```python
element = page.css('.product')[0]

element.text                   # Text content
element.attrib['href']         # Single attribute
element.css('img::attr(src)')  # Nested attribute

# Navigate DOM
element.parent
element.next_sibling
element.find_similar()         # Find structurally similar elements
```

## Session (maintain cookies/login state)

```python
from scrapling.fetchers import FetcherSession

with FetcherSession(impersonate='chrome') as session:
    # Login
    login = session.post('https://site.com/login', data={
        'username': 'user', 'password': 'pass'
    })

    # Subsequent requests keep the session
    dashboard = session.get('https://site.com/dashboard')
    data = dashboard.css('.data-row::text').getall()
```

## Anti-Bot / Cloudflare Sites

```python
from scrapling.fetchers import StealthyFetcher

page = StealthyFetcher.fetch(
    'https://protected-site.com',
    headless=True,
    solve_cloudflare=True
)
data = page.css('.content::text').getall()
```

## JavaScript-Rendered Pages

```python
from scrapling.fetchers import DynamicFetcher

page = DynamicFetcher.fetch(
    'https://spa-app.com',
    headless=True,
    network_idle=True    # Wait for all requests to finish
)
data = page.css('.dynamic-content::text').getall()
```

## Scrape a Table to Structured Data

```python
from scrapling.fetchers import Fetcher
import json

page = Fetcher.get('https://example.com/data')

rows = []
for tr in page.css('table tbody tr'):
    cells = tr.css('td::text').getall()
    rows.append(cells)

# Save as JSON
with open('output.json', 'w') as f:
    json.dump(rows, f, indent=2)
print(json.dumps(rows[:3], indent=2))  # Preview
```

## Multi-Page Crawl

```python
from scrapling.fetchers import FetcherSession

results = []
with FetcherSession(impersonate='chrome') as session:
    for page_num in range(1, 11):
        page = session.get(f'https://example.com/items?page={page_num}')
        for item in page.css('.item'):
            results.append({
                'name': item.css('.name::text').get(),
                'price': item.css('.price::text').get(),
                'url': item.css('a::attr(href)').get(),
            })

import json
with open('results.json', 'w') as f:
    json.dump(results, f, indent=2)
print(f"Scraped {len(results)} items")
```

## Tips

- Always preview results before writing large outputs: `print(data[:5])`
- Use `.get()` for first match, `.getall()` for all matches
- For `::text` and `::attr()` pseudo-elements, use CSS not XPath
- Save outputs to `/workspace/group/` so files persist between sessions
- If a site blocks you with `Fetcher`, try `StealthyFetcher` before giving up
- For very large scrapes, save incrementally rather than accumulating everything in memory
