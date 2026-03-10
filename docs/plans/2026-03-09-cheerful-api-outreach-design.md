# Cheerful API Outreach — Add Creators to Campaign

## Context

The cheerful-api agent skill currently only supports Shopify order creation. We need to add the ability for the agent to trigger outbound outreach by adding creators to existing active campaigns — mimicking a creator being added to a campaign in the Cheerful UI.

## Design Decisions

- **Both recipient endpoints supported:** Agent uses `/campaigns/{id}/recipients` when it has email, and `/campaigns/{id}/recipients-from-search` when it has social handles (from creator-search skill).
- **Existing active campaigns only:** Agent adds recipients to already-launched campaigns. Campaign creation/launch stays in the UI.
- **Campaign resolution:** Agent uses a `list_active_campaigns()` helper to resolve campaign names to IDs or pick the only active one. No hardcoded IDs.
- **Batch support:** Functions accept lists of creators, matching the API's native batch behavior.
- **Self-contained:** Campaign listing helper included in this skill (not delegated to cheerful-supabase).

## New Functions

### `list_active_campaigns(user_email)`
- Queries Supabase directly: `campaign` table filtered by `status=eq.ACTIVE`, scoped by `CLIENT_IDS`
- Returns: `[{id, name, created_at}]`
- Uses service role key (no JWT needed)

### `add_recipients_to_campaign(campaign_id, recipients, user_email)`
- Endpoint: `POST /campaigns/{campaign_id}/recipients`
- Request body: `[{email, name, custom_fields}]`
- Auth: JWT via `get_user_jwt(user_email)`
- Success: returns list of created recipients
- Queue population happens automatically server-side

### `add_creators_from_search(campaign_id, creators, user_email)`
- Endpoint: `POST /campaigns/{campaign_id}/recipients-from-search`
- Request body: `[{email (optional), name, social_media_handles: [{platform, handle, url}], custom_fields}]`
- Auth: JWT via `get_user_jwt(user_email)`
- Creators without email get queued for enrichment automatically
- Success: returns per-creator status (created/existing/pending_enrichment)

## Skill Document Changes

1. Update YAML frontmatter description to mention outreach
2. Add new section "Outreach — Add Creators to Campaign" after existing Error Handling section
3. Include: `list_active_campaigns()`, `add_recipients_to_campaign()`, `add_creators_from_search()`, usage examples

## Error Handling

Reuses existing `urllib.error.HTTPError` pattern:
- 404: campaign not found
- 422: validation error (campaign not active, invalid email)
- 401: JWT expired
