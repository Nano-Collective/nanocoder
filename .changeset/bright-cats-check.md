---
'@nanocollective/nanocoder': patch
---

Keep failed update checks out of the chat, throttle successful automatic checks to once every 24 hours, and support opting out with `NANOCODER_NO_UPDATE_CHECK=1`. The `/update` command continues to perform a fresh check. Closes #1738.
