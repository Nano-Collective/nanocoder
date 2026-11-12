---
"@nanocollective/nanocoder": minor
---

Trimmed the slash command list by folding overlapping commands into the ones they belong to: `/login codex` and `/login copilot` replace `/codex-login` and `/copilot-login`, `/memory add` replaces `/remember`, `/model browse` replaces `/model-database`, `/skills schedule` replaces `/schedule`, and `/quit` is now just `/exit`. The old names still work exactly as before, but are no longer listed in `/help` or the slash menu, and `/help <old name>` opens the command it now runs. `/tip`, `/privacy` and `/credits` also drop out of the `/help` overview while still working, and `/setup-config` now says plainly that it opens a config file in `$EDITOR`.
