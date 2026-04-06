# Brave Search API Migration Plan

## Problem

All scraper-based search engines (Brave, DuckDuckGo, Google) now return CAPTCHAs for programmatic requests. The current `web_search` tool scrapes Brave Search HTML and is broken. No user-agent or header trick will reliably bypass this — they use TLS fingerprinting, JavaScript challenges, and image CAPTCHAs.

## Solution

Replace the HTML scraper with the [Brave Search API](https://api.search.brave.com/) (free tier: 2,000 queries/month). The tool becomes opt-in: users provide a `BRAVE_SEARCH_API_KEY` in their `agents.config.json`, and the tool is only registered when the key is present.

## Config Schema Change

Extend the existing `nanocoderTools` key in `AppConfig` (which currently only has `alwaysAllow`):

```jsonc
// agents.config.json
{
  "nanocoderTools": {
    "alwaysAllow": ["read_file"],         // existing field
    "webSearch": {                         // new field
      "apiKey": "$BRAVE_SEARCH_API_KEY"   // supports env var substitution
    }
  }
}
```

## Changes

### 1. Config type update — `source/types/config.ts`

Extend `NanocoderToolsConfig` (or equivalent) to add:

```typescript
nanocoderTools?: {
  alwaysAllow?: string[];
  webSearch?: {
    apiKey?: string;
  };
};
```

### 2. Rewrite `web_search` executor — `source/tools/web-search.tsx`

Replace `executeWebSearch` to call the Brave Search API instead of scraping HTML:

- **Endpoint**: `GET https://api.search.brave.com/res/v1/web/search`
- **Auth**: `X-Subscription-Token: <apiKey>` header
- **Params**: `q` (query), `count` (max_results)
- **Response**: JSON with `web.results[]` containing `title`, `url`, `description`
- **Remove** the `cheerio` dependency (it becomes unused after this change — verify with knip)

The execute function reads the API key from config at call time (not at registration) so config reloads are respected.

### 3. Conditional tool registration — `source/tools/index.ts`

Currently all static tools are unconditionally added to the registries. Change this so `web_search` is only included when a Brave API key is configured:

```typescript
// In the static tools array construction:
const staticTools: NanocoderToolExport[] = [
  readFileTool,
  writeFileTool,
  // ... other always-available tools
  ...(getBraveSearchApiKey() ? [webSearchTool] : []),
  fetchUrlTool,
  // ...
];
```

Where `getBraveSearchApiKey()` reads from the resolved config. This means when no key is set, `web_search` never appears in the tool definitions sent to the model.

**Important**: Since `ToolManager` is created once during app init, and config can be reloaded, we need to verify whether `ToolManager.initializeStaticTools()` re-runs on config reload or if this is a one-shot setup. If one-shot, that's fine — the key is either there at startup or it isn't.

### 4. Update formatter — `source/tools/web-search.tsx`

Change the engine display label from `Brave Search` to `Brave Search API`.

### 5. Error handling

- If the API returns 401/403 → throw a clear error: "Invalid Brave Search API key"
- If the API returns 429 → throw: "Brave Search API rate limit exceeded"
- Keep the existing timeout handling

### 6. Update tests — `source/tools/web-search.spec.tsx`

The existing test file (754 lines) covers validator, formatter, executor, and result parsing — all against the HTML scraper. Needs a full rewrite of the executor/parsing tests:

- **Remove**: All HTML parsing tests, cheerio-related mocking, `data-type="web"` selector tests
- **Add**: Brave API response mocking (JSON `web.results[]` shape), API key header verification
- **Add**: Error handling tests for 401/403 (invalid key), 429 (rate limit)
- **Add**: Test that tool registration is skipped when no API key is configured
- **Keep**: Validator tests (query validation, length checks) — these are unchanged
- **Update**: Formatter tests to reflect `Brave Search API` engine label

### 7. Update documentation

- **`docs/configuration/index.md`** — Currently documents `nanocoderTools.alwaysAllow` only (lines 136-150). Add a new subsection documenting `nanocoderTools.webSearch.apiKey`, how to get a Brave API key, and the env var substitution pattern
- **`source/app/prompts/main-prompt.md`** — References `web_search` in context gathering; update to note it requires a Brave API key
- **`agents/2025-10-05-web-search-fetch-tools.md`** — Old implementation plan referencing `duck-duck-scrape`; archive or update to reflect the API-based approach

## Files Changed

| File | Change |
|------|--------|
| `source/types/config.ts` | Add `webSearch` to `nanocoderTools` type |
| `source/tools/web-search.tsx` | Replace scraper with API call, update formatter |
| `source/tools/web-search.spec.tsx` | Rewrite executor/parsing tests for API, add conditional registration tests |
| `source/tools/index.ts` | Conditionally include `web_search` based on API key |
| `docs/configuration/index.md` | Document `webSearch` config under `nanocoderTools` section |
| `source/app/prompts/main-prompt.md` | Note API key requirement for `web_search` |
| `agents/2025-10-05-web-search-fetch-tools.md` | Archive or update old implementation plan |
| `package.json` | Remove `cheerio` (only used by the scraper) |

## Verification

1. `pnpm run test:all` — must pass
2. Confirm `web_search` tool does NOT appear in tool definitions when no key is set
3. Confirm `web_search` works with a valid key
4. `knip` will flag if `cheerio` is now unused
