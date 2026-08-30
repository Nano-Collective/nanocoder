---
"@nanocollective/nanocoder": patch
---

Fixed sub-agent tool calls being denied silently under ACP. A tool call made inside a dispatched sub-agent went through the global approval slot, which no ACP code path ever installs a handler for, so its safe fallback denied every one without the client seeing a `session/request_permission`. Delegated work could only write by bypassing approval entirely, which was invisible to a client that gates writes. Sub-agent calls now use the same permission channel as top-level ones, announced first so the request names a known tool call, and titled with the sub-agent so the client can tell them apart. Closes #1019.
