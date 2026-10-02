---
"@nanocollective/nanocoder": patch
---

Keep `globalThis.process` intact when `fetch_url` or file caching converts HTML through get-md: pages with an `<iframe>` make happy-dom windows that null the global after get-md's own restore, and the next `process` read crashed the app through the fatal-error handler. The logging config, logger provider and shutdown manager now use a module-level `process` reference, the uncaught-exception and unhandled-rejection handlers fall back to stderr when the logger itself throws, and the conversion calls restore the global afterwards. Closes #1553.
