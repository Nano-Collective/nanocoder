---
'@nanocollective/nanocoder': patch
---

Three fixes around the `daemon start` trust gate, all of them about what users are told rather than about the gate itself, which already refuses correctly.

`ensureDirectoryTrust` reported `persisted: true` whenever it *attempted* the `NANOCODER_TRUST_DIRECTORY=1` write, but `savePreferences` swallows write errors and returns success either way. On a failed write (read-only config dir, full disk) `daemon start` printed "Marked &lt;dir&gt; as trusted" while the next boot's own gate refused the directory — the message was untrue and the user had no way to tell. `savePreferences` now returns whether the write landed, and the trust result only claims a persisted entry when it did.

`nanocoder daemon install` now warns when the project root isn't trusted yet. Auto-start is the one boot nobody watches: launchd, systemd, and Task Scheduler all invoke `nanocoder daemon start`, whose output goes to `.nanocoder/daemon.log`, so an untrusted install succeeds and then fails on every login into a file users don't read. `install` itself stays ungated by design — it only writes the unit — it just says up front what will happen.

`docs/features/skills.md` and `docs/features/scheduler.md` document the gate. Both are pages where users meet the daemon, and both previously said only "run `nanocoder daemon start`".
