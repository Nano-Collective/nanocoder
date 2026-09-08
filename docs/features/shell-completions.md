---
title: "Shell Completions"
description: "Tab-completion for nanocoder subcommands and flags in bash, zsh, and fish"
sidebar_order: 15
---

# Shell Completions

Nanocoder can generate tab-completion scripts for your shell, so subcommands (`run`, `init`, `daemon`, …) and flags (`--provider`, `--mode`, `--json`, …) complete as you type. The shell argument is required — there is no default, so you always get the script you asked for.

## bash

```bash
nanocoder completion bash >> ~/.bashrc
```

or drop it into a completion directory:

```bash
nanocoder completion bash | sudo tee /etc/bash_completion.d/nanocoder
```

## zsh

```bash
nanocoder completion zsh > ~/.oh-my-zsh/completions/_nanocoder
```

or eval it directly from your `~/.zshrc`:

```bash
eval "$(nanocoder completion zsh)"
```

The generated script works both ways: when eval'd it registers itself with `compdef`, and when placed in a directory on your `fpath` the `#compdef nanocoder` header makes it autoload.

## fish

```bash
nanocoder completion fish > ~/.config/fish/completions/nanocoder.fish
```

## What gets completed

The scripts cover the full command-line surface:

- **Subcommands** — `init`, `run`, `daemon`, `codex`, `copilot`, `completion`, plus their nested arguments (`daemon start|stop|status|logs|install|uninstall`, `codex|copilot login`, and the shell names for `completion`).
- **Flags** — every top-level option, including short forms (`-c`, `-r`, `-h`, `-v`).
- **Known flag values** — `--mode normal|auto-accept|yolo|plan` and `--output-format text|json` offer their closed sets of values.

In-app slash commands (like `/clear` or `/doctor`) are not part of this — they are typed inside the TUI, which has its own completion, and the shell never sees them.

## Keeping scripts in sync

The completion scripts are rendered from a single spec in `source/cli-completions/spec.ts`. When a new flag or subcommand is added to the CLI, update that spec (and the `--help` text) and the bash, zsh, and fish scripts all pick it up; a test in `source/cli-completions/cli.spec.ts` fails if any script drifts from the spec.
