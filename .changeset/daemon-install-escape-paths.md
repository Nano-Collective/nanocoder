---
"@nanocollective/nanocoder": patch
---

Fix `nanocoder daemon install` for project paths with special characters. The macOS LaunchAgent plist now XML-escapes the project path and the daemon command, so a path with `&` or `<` no longer gives a plist that `plutil -lint` rejects. The Linux systemd unit now writes `%` as `%%` and quotes the `Environment=` value, so systemd reads a path with a space or `%` unchanged instead of cutting it at the space or expanding it as a specifier. Closes #2240.
