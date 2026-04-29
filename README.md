# Nanocoder

A local-first CLI coding agent built by the [Nano Collective](https://nanocollective.org) — a community collective building AI tooling not for profit, but for the community. Everything we build is open, transparent, and driven by the people who use it.

Nanocoder brings the power of agentic coding tools like Claude Code and Gemini CLI to local models or controlled APIs like OpenRouter. Built with privacy and control in mind, it supports multiple AI providers with tool support for file operations and command execution.

![Example](./.github/assets/example-preview.gif)

---
![Build Status](https://github.com/Nano-Collective/nanocoder/raw/main/badges/build.svg)
![Coverage](https://github.com/Nano-Collective/nanocoder/raw/main/badges/coverage.svg)
![Version](https://github.com/Nano-Collective/nanocoder/raw/main/badges/npm-version.svg)
![NPM Downloads](https://github.com/Nano-Collective/nanocoder/raw/main/badges/npm-downloads-monthly.svg)
![NPM License](https://github.com/Nano-Collective/nanocoder/raw/main/badges/npm-license.svg)
![Repo Size](https://github.com/Nano-Collective/nanocoder/raw/main/badges/repo-size.svg)
![Stars](https://github.com/Nano-Collective/nanocoder/raw/main/badges/stars.svg)
![Forks](https://github.com/Nano-Collective/nanocoder/raw/main/badges/forks.svg)

## Quick Start

```bash
npm install -g @nanocollective/nanocoder
nanocoder
```

Also available via [Homebrew](docs/getting-started/installation.md#homebrew-macoslinux) and [Nix Flakes](docs/getting-started/installation.md#nix-flakes).

### CLI Flags

Specify provider, model, and starting mode directly:

```bash
# Non-interactive mode with specific provider/model
nanocoder --provider openrouter --model google/gemini-3.1-flash run "analyze src/app.ts"

# Interactive mode starting with specific provider
nanocoder --provider ollama --model llama3.1

# Flags can appear before or after 'run' command
nanocoder run --provider openrouter "refactor database module"

# Boot directly into a development mode (normal, auto-accept, yolo, plan)
nanocoder --mode yolo
nanocoder --mode plan run "audit the auth module"
```

## Documentation

Full documentation is available online at **[docs.nanocollective.org](https://docs.nanocollective.org/nanocoder/docs)** or in the [docs/](docs/) folder:

- **[Getting Started](docs/getting-started/index.md)** - Installation, setup, and first steps
- **[Configuration](docs/configuration/index.md)** - AI providers, MCP servers, preferences, logging, timeouts
- **[Features](docs/features/index.md)** - Custom commands, checkpointing, development modes, task management, and more
- **[Commands Reference](docs/features/commands.md)** - Complete list of built-in slash commands
- **[Keyboard Shortcuts](docs/features/keyboard-shortcuts.md)** - Full shortcut reference
- **[Community](docs/community.md)** - Contributing, Discord, and how to help

## Community

The Nano Collective is a community collective building AI tooling for the community, not for profit. We'd love your help.

- **Contribute**: See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.
- **The collective**: [nanocollective.org](https://nanocollective.org) · [docs](https://docs.nanocollective.org) · [GitHub](https://github.com/Nano-Collective) · [Discord](https://discord.gg/ktPDV6rekE)
- **Support the work**: The [Support page](https://docs.nanocollective.org/collective/organisation/support) covers donations and sponsorship.
- **Paid contribution**: The [Economics Charter](https://docs.nanocollective.org/collective/organisation/economics-charter) sets out how scoped paid bounties work.
