---
"@nanocollective/nanocoder": patch
---

ACP now recognises a cancelled prompt by the turn's own abort signal, not by matching the text `Operation was cancelled`. A prompt the user stopped now resolves as cancelled, with the inline notice, whatever error the interrupted work threw. An internal abort that only uses that wording is reported as an error. A turn cancelled part way through is no longer used to generate a session title.
