---
"@nanocollective/nanocoder": patch
---

Fixed the VS Code extension being unable to start the CLI on Windows. `where.exe` lists npm's unexecutable extensionless shim before `nanocoder.cmd`, and the first line was taken blindly; spawning a `.cmd` also fails with EINVAL because Node refuses to run one without a shell (CVE-2024-27980). Discovery now ranks `where.exe` matches by extension, the CLI is launched via the JS entrypoint resolved from the shim, and a `.cmd` that cannot be resolved falls back to a quoted shell spawn. Spawn failures are also caught and reported in the Nanocoder output channel instead of being swallowed as an unhandled rejection that left the UI stuck on "Connecting".
