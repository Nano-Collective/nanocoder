---
"@nanocollective/nanocoder": minor
---

Added a **terminal bell** option to notifications. Every notifier Nanocoder had was desktop-only — `terminal-notifier`, `osascript`, `notify-send`, the PowerShell balloon — so anyone driving Nanocoder over SSH, inside tmux, or from a remote container got nothing at all when a long run finished. `notifications.bell` now also writes a BEL character to stdout for whichever events you have enabled, which the terminal in front of you renders as a beep or a visual flash. Toggle it under `/settings` → Input → Notifications, next to Sound. BEL is non-printing, so it does not disturb the rendered frame, and it is skipped when stdout is not a TTY so piped output and daemon logs stay clean. Also corrected the notification docs, which described the preference as living under a `nanocoder.notifications` namespace — it is read from the top-level `notifications` key, so anything written at the documented path was silently ignored. Closes #931.
