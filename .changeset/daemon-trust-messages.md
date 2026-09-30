---
'@nanocollective/nanocoder': patch
---

Two fixes around the `daemon start` trust gate, both about what users are told rather than about the gate itself, which already refuses correctly.

`ensureDirectoryTrust` reported `persisted: true` whenever it *attempted* the `NANOCODER_TRUST_DIRECTORY=1` write, but `savePreferences` swallows write errors and returned void either way. On a failed write (read-only config dir, full disk) `daemon start` printed "Marked <dir> as trusted" while the next boot's own gate refused the directory — the message was untrue and the user had no way to tell. `savePreferences` now returns whether the write landed, and the trust result only claims a persisted entry when it did. Its return type is intentionally part of the public `DirectoryTrustDeps` contract and accepts `boolean | void`, so existing injected savers that return nothing keep working.

`docs/features/skills.md` and `docs/features/scheduler.md` document the gate where users meet it: the trust options, and the `daemon install` asymmetry — install writes the auto-start unit and warns when the project is untrusted, while the gate itself fires on every unattended boot.
