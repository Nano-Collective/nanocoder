---
"@nanocollective/nanocoder": patch
---

The models.dev cache now lives in each platform's cache directory: `~/Library/Caches/nanocoder` on macOS and `%LOCALAPPDATA%\nanocoder\cache` on Windows. Before, it was in `~/.cache/nanocoder` on every platform. Linux is unchanged, and `XDG_CACHE_HOME` is still honoured on every platform when set. On macOS and Windows the model database is downloaded once more after upgrading, and the old `~/.cache/nanocoder/models.json` can be deleted.
