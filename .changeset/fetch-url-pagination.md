---
"@nanocollective/nanocoder": minor
---

`fetch_url` can now read past the 100,000-character cut. It takes optional `start_index` and `max_length` arguments, and the truncation note says where to continue: `[Content truncated - showing characters 0-100000 of 482113. Call fetch_url again with start_index=100000 to continue.]`. Windows never split an emoji or other surrogate pair, `max_length` is capped at the existing 100,000, and the converted page is kept for 90 seconds so reading a long page in parts does not download and convert it again for every part. Only the markdown is cached: every call still walks and validates the redirect chain, so a cached page is refused as readily as a fresh one once its address stops being safe. The tool output line now shows the characters being shown instead of a flat "truncated" warning.
