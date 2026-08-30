---
"@nanocollective/nanocoder": patch
---

Allowed `skill:<name>` subscription targets in skill manifests. This fixes manifest parsing, bundle loading, and event-router registration for cross-skill subscriptions while keeping unresolved command, agent, and tool targets rejected. Thanks to @1cbyc. Closes #1011.
