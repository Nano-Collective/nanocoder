---
'@nanocollective/nanocoder': minor
---

Add `nanocoder config` to see your settings and which file each one came from.

Settings come from four places: built-in defaults, your global config folder, the project folder you're in, and `NANOCODER_*` environment variables. When a setting didn't do what you expected, finding out which file set it meant opening all four by hand.

Three commands:

- `nanocoder config list` — every setting, its value, and the file it came from
- `nanocoder config show <key>` — one setting in detail: its default, and any values it beat
- `nanocoder config diff` — only what your files change, plus values that are set but unused

All three take `--json`.

**The part worth knowing.** Settings are grouped into blocks, like `autoCompact`. Nanocoder takes the *whole* block from the first file that mentions it — it does not mix fields from two files. So if your global config sets `threshold` and `notifyUser`, and your project config sets only `threshold`, your `notifyUser` is thrown away and the built-in default is used instead. Nothing told you that before. `config diff` now lists it under "Ignored values".

Two smaller things. Values are shown the way the app really uses them — write `threshold: 200` and you'll see `95`, because it's capped at 95. And API keys show as `<redacted>`, so you can paste the output into a bug report.
