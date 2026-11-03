---
'@nanocollective/nanocoder': patch
---

Two fixes around the `daemon start` trust gate, both about what users are told rather than about the gate itself, which already refuses correctly.

`ensureDirectoryTrust` reported `persisted: true` whenever it *attempted* the `NANOCODER_TRUST_DIRECTORY=1` write, but `savePreferences` swallows write errors and returned void either way. On a failed write (read-only config dir, full disk) `daemon start` printed "Marked <dir> as trusted" while the next boot's own gate refused the directory — the message was untrue and the user had no way to tell. `savePreferences` now returns whether the write landed, and the trust result only claims a persisted entry when it did. Its return type is intentionally part of the public `DirectoryTrustDeps` contract and accepts `boolean | void`, so existing injected savers that return nothing keep working.

A failed write is not silent either: `daemon start` prints a warning naming the directory and saying the next start will refuse it again. The trust result carries a distinct `persistFailed` flag for this, because `persisted: false` alone also covers `--trust-directory` and an already-recorded folder — paths where nothing went wrong and a warning would be wrong.

`docs/features/skills.md` and `docs/features/scheduler.md` document the gate where users meet it: the trust options, and the `daemon install` asymmetry — install writes the auto-start unit and warns when the project is untrusted, while the gate itself fires on every unattended boot. The refusal comes from `daemon start` before the daemon child that owns `daemon.log` is spawned, so it goes to that command's own output, not to the log file.
