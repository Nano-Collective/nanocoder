---
"@nanocollective/nanocoder": patch
---

Upgrade the terminal UI to Ink 8 and React 19.3. This lets the app stop patching Ink: the pnpm patch that exposed raw key sequences is gone, and backspace, forward-delete and the kitty keyboard encodings are handled by Ink itself. Shift+Enter sent as xterm's modifyOtherKeys encoding (`CSI 27;2;13~`) is no longer recognised; every terminal that can distinguish Shift+Enter now does so through the kitty keyboard protocol negotiated at startup, and a terminal keybinding that sends a line feed still works.
