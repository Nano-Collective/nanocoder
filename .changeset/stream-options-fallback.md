---
"@nanocollective/nanocoder": patch
---

OpenAI-compatible endpoints that reject `stream_options` no longer fail every request. Streaming usage reporting is on by default, which sends `stream_options.include_usage`, and some strict endpoints and proxies answer that with a 400 or 422. When `includeUsage` is not set in the provider config and the error names `stream_options` or `include_usage`, Nanocoder now retries the request once without it and leaves it off for the rest of the session. Set `includeUsage: false` to skip the initial failed request entirely.
