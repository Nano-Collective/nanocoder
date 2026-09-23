---
'@nanocollective/nanocoder': patch
---

Vertically center the welcome banner on tall terminals.

The banner sat flush at the top of the viewport on terminals taller than the banner itself, so a maximized window left the content stranded at the top. The banner's outer Box is now sized to the available rows and centers its children, so the block sits in the middle of the viewport at every terminal height while still fitting a standard 80×24 screen.

Also adds regression tests for the boot summary's working-directory label and for the new tagline text.
