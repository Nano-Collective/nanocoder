---
"@nanocollective/nanocoder": minor
---

- **`nanocoder run --prompt-file <path>` reads the prompt from a file instead
  of the command line.** Linux caps a *single* argv entry at `MAX_ARG_STRLEN`
  — 32 pages, 131072 bytes — independently of the much larger `ARG_MAX` total,
  and `execve` fails with `E2BIG` before the process starts. macOS has no
  equivalent per-argument cap.

  That combination is a trap for any caller that assembles a prompt rather than
  typing one: it works in local testing on a Mac and then cannot spawn at all
  on a Linux CI runner. Sentinel embeds the files it audits into the prompt and
  hit exactly this — every pack returned `spawnSync nanocoder E2BIG` on
  `ubuntu-latest` at 314 KiB and 218 KiB, having passed on macOS throughout.

  A file has no such ceiling. The flag takes precedence over a positional
  prompt, and a missing or unreadable path exits with a message rather than
  running against an empty prompt.

- **The CLI parsing test mirror is back in step with the parser.** `cli.spec.ts`
  duplicates the argv filter by hand, and had fallen six flags behind it:
  `--mode`, `--json`, `--output-format`, `--trust-directory` and the alt-screen
  pair were all stripped by the real parser and left in the prompt by the
  mirror, so those tests were passing against a parser that is not shipped. A
  test now asserts the two agree.
