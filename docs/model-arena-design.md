# Model Arena — Privacy & Vote Ingestion Design

> Status: design draft for [#663](https://github.com/Nano-Collective/nanocoder/issues/663)
> Related: [#439](https://github.com/Nano-Collective/nanocoder/issues/439)
> Principle: Nanocoder is local-first and privacy-respecting. Arena telemetry is **opt-in**, **minimal**, and **never** includes prompts, responses, or identifying metadata.

This document defines the vote payload, explicit non-goals for data collection, consent defaults, transport choice, and abuse controls for Phase 1.

---

## 1. Exact vote payload schema

A vote is a single JSON object. The client **must** send only these four fields. Servers **must** reject payloads that include any additional properties.

### 1.1 Fields

| Field | Type | Constraints | Description |
| --- | --- | --- | --- |
| `provider` | `string` | Non-empty; max 64 chars; printable ASCII / UTF-8 without control chars | Configured provider id (e.g. `openrouter`, `ollama`, `anthropic`) |
| `model_name` | `string` | Non-empty; max 128 chars; printable ASCII / UTF-8 without control chars | Model identifier as known to Nanocoder (e.g. `claude-sonnet-4`, `llama3.2`) |
| `rating` | `integer` | Exactly one of `-2`, `-1`, `0`, `1`, `2` | User rating for that turn's model performance |
| `timestamp` | `string` | ISO 8601 UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`) | Client clock time when the vote was submitted |

### 1.2 Rating scale (UI mapping)

| UI label | `rating` |
| --- | ---: |
| Excellent | `+2` |
| Good | `+1` |
| Ok | `0` |
| Bad | `-1` |
| Terrible | `-2` |

### 1.3 Canonical JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://nanocollective.org/schemas/model-arena-vote.json",
  "title": "ModelArenaVote",
  "type": "object",
  "additionalProperties": false,
  "required": ["provider", "model_name", "rating", "timestamp"],
  "properties": {
    "provider": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64
    },
    "model_name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128
    },
    "rating": {
      "type": "integer",
      "enum": [-2, -1, 0, 1, 2]
    },
    "timestamp": {
      "type": "string",
      "format": "date-time"
    }
  }
}
```

---

## 2. Explicitly excluded data

The following **must never** be included in any vote payload or logged alongside it:

- Prompt content or any user-typed text
- Model response content
- File paths, file names, or file contents from the user's project
- Repository names or git remote URLs
- User identifiers (username, email, GitHub handle)
- IP address or any IP-derived geolocation
- Session IDs, machine IDs, or hardware fingerprints
- API keys or provider credentials

If any future field is proposed for the payload, it must be checked against this list before being added, and this document must be updated first.

---

## 3. Consent and defaults

- `arenaEnabled` defaults to `false` for all users, on both fresh installs and upgrades.
- Enabling requires an explicit `/enable_arena` command.
- On first `/enable_arena`, Nanocoder must show a one-time message summarizing what data is collected (linking to this document) before the setting takes effect.
- `/disable_arena` immediately stops future vote prompts; no confirmation dialog is needed to turn it off.
- The setting is stored in the existing local config file only — never synced or transmitted except as part of a vote payload itself.

---

## 4. Transport mechanism

**Recommendation: direct HTTPS POST from Nanocoder to a lightweight ingest endpoint**, rather than requiring users to hold a GitHub token with write access to the website repo.

Reasoning:
- Repo-dispatch via `workflow_dispatch` or `repository_dispatch` requires a GitHub token scoped to the website repo, which is not something end users should be expected to hold or manage.
- A small ingest endpoint (e.g. a serverless function) can validate and rate-limit payloads before they ever touch the website repo, keeping the CLI decoupled from GitHub's API entirely.
- The endpoint writes validated votes to a queue/store; a separate scheduled job or GitHub Action aggregates them into the website's data file, keeping user-facing latency low and avoiding exposing repo write access to any client.

Open question for maintainers: where should this endpoint be hosted, and who owns its deployment? This must be resolved before Phase 1 (Prompt 4) implementation begins.

---

## 5. Rate limiting and abuse prevention

- One vote per model response — the vote prompt is shown once and is not re-shown for the same turn.
- No vote editing or resubmission after a vote is sent.
- Client-side: if the network call fails, it is not retried automatically (avoids retry storms); it fails silently from the user's perspective.
- Server-side: ingest endpoint should apply basic per-IP or per-request rate limiting (exact thresholds TBD by whoever owns the endpoint — flagged as an open item, not blocking Phase 1 client work).
