---
'@nanocollective/nanocoder': minor
---

Publish a JSON Schema for `agents.config.json` as `schemas/agents.config.schema.json`. It is generated deterministically from the on-disk `DiskConfig` type (`pnpm run generate:schema`), ships with an Ajv validation suite plus a CI drift check, and enables editor autocompletion — either by dropping the `$schema` key into your config or by wiring up the schema via `jsonValidation` / a JSON Schema mapping in your editor.
