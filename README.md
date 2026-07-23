# Nanocoder

[简体中文](README.zh-CN.md)
[繁體中文](README.zh-TW.md)

An open coding agent for your terminal, built by a community collective rather than a company. Bring your own model, keep your code on your machine, and owe nothing to anyone.

Built by the [Nano Collective](https://nanocollective.org), a community collective building AI tooling not for profit, but for the community. Nanocoder runs agentic coding on the model of your choice: local models via Ollama, or any OpenAI-compatible API such as OpenRouter, Anthropic, and Google. You decide which provider runs your code and where your data goes. No closed-source features and no paid tiers gating the useful parts: **privacy-respecting**, **local-first**, and **open for all**.

[![Typing SVG](https://readme-typing-svg.herokuapp.com?font=&size=33&letterSpacing=large&pause=1000&color=8373F7&center=true&vCenter=true&width=1000&lines=Nanocoder;your+private+%2C+local+first+AI+coding+assistant)](https://git.io/typing-svg)

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

<a href="https://www.star-history.com/#Nano-Collective/nanocoder&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Nano-Collective/nanocoder&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Nano-Collective/nanocoder&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Nano-Collective/nanocoder&type=Date" />
 </picture>
</a>

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

# Fullscreen mode with in-app scrolling instead of the inline default
nanocoder --alt-screen
```

### Screen Modes

Nanocoder supports two rendering modes, mirroring what Claude Code and Codex ship:

- **Inline (default)** — renders on the main screen; finished messages print once into the terminal's native scrollback, so your terminal's scrollbar, mouse wheel, and search work as usual. The transcript stays in the terminal after you exit.
- **Fullscreen** (`--alt-screen` flag, or `"alternateScreen": true` in preferences) — a fixed-height layout on the alternate screen buffer with in-app scrolling: mouse wheel and PgUp/PgDn, with a scroll indicator and automatic snap-back to bottom on new output. `--no-alt-screen` forces inline mode even if the preference is set.

In both modes, `/clear` fully resets the terminal to a fresh welcome banner, and exiting (Ctrl+C or `/exit`) erases the input UI cleanly, leaving the transcript and a farewell instead of a dead input box.

## Documentation

Full documentation is available online at **[docs.nanocollective.org](https://docs.nanocollective.org/nanocoder/docs)** or in the [docs/](docs/) folder:

- **[Getting Started](docs/getting-started/index.md)** - Installation, setup, and first steps
- **[Configuration](docs/configuration/index.md)** - AI providers, MCP servers, preferences, logging, timeouts
- **[Features](docs/features/index.md)** - Skills (commands, subagents, tools, event triggers), the per-project daemon, checkpointing, development modes, task management, and more
- **[Commands Reference](docs/features/commands.md)** - Complete list of built-in slash commands
- **[Keyboard Shortcuts](docs/features/keyboard-shortcuts.md)** - Full shortcut reference
- **[Community](docs/community.md)** - Contributing, Discord, and how to help

## Why a collective

Nanocoder is built by the Nano Collective rather than a company, and that shapes the tool itself. There are no paid tiers, no telemetry quietly shipping your prompts somewhere, and no roadmap steered by what monetises best — the people building it are the people using it. Building in the open as a collective means the harness stays multi-provider on principle: you are never locked to one vendor's model, and the conventions, tests, and release standards are shared across every Nano Collective project so the work stays legible and contributable.

It is also bigger than one tool. The collective is assembling an open ecosystem of AI tooling — see the [other projects](https://nanocollective.org) — and contributors who show up now help shape what that becomes.

## Sponsors

Nanocoder is built not for profit, but for the community, and that work is funded by sponsors. [Become one](https://nanocollective.org/sponsor).

### [Atlas Cloud](https://www.atlascloud.ai/console/coding-plan)

<p>
  <a href="https://www.atlascloud.ai/console/coding-plan" title="Atlas Cloud">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://nanocollective.org/sponsors/atlas-cloud-white.png">
      <img alt="Atlas Cloud" height="40" src="https://nanocollective.org/sponsors/atlas-cloud-black.png">
    </picture>
  </a>
</p>

> Atlas Cloud is a full-modal AI inference platform that gives developers a single AI API to access video generation, image generation, and LLM APIs. Instead of managing multiple vendor integrations, you connect once and get unified access to 300+ curated models across all modalities.

Check out [Atlas Cloud's new coding plan promotion](https://www.atlascloud.ai/console/coding-plan) for more budget-friendly API access.

## Community

The Nano Collective is a community collective building AI tooling for the community, not for profit. We'd love your help.

- **Contribute**: See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.
- **The collective**: [nanocollective.org](https://nanocollective.org) · [docs](https://docs.nanocollective.org) · [GitHub](https://github.com/Nano-Collective) · [Discord](https://discord.gg/ktPDV6rekE)
- **Support the work**: The [Support page](https://docs.nanocollective.org/collective/organisation/support) covers donations and sponsorship.
- **Paid contribution**: The [Economics Charter](https://docs.nanocollective.org/collective/organisation/economics-charter) sets out how scoped paid bounties work.
