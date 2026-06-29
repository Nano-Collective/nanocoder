---
title: "Battlemap"
description: "How Nanocoder compares to other CLI coding agents, and why it is the right choice for local-first, privacy-respecting, community-led AI coding"
sidebar_order: 3
---

# Nanocoder Battlemap

> A beautiful privacy-first coding agent running in your terminal.

This is an honest comparison of Nanocoder against the most relevant CLI coding agents on the market. Honest meaning: where Nanocoder leads, this doc says so plainly; where parity exists, that is stated too; and where the project is genuinely behind, it is not hidden.

The short version: Nanocoder is the most provider-diverse, most feature-complete, **community-driven, privacy-respecting, local-first** coding agent in the terminal today. The longer version is below.

## What Nanocoder is

A CLI coding agent built by the [Nano Collective](https://nanocollective.org), a community-led group of developers, designers, and maintainers building open-source AI tools for the people who use them. Not for profit. Not venture-backed. Not gated behind a paid tier. Built so that the power of agentic coding tools belongs to everyone, not just to whoever owns the closest GPU cluster.

The project rests on three purposes, in equal measure:

- **Community-driven.** Owned by the Nano Collective, governed in public, contribution model written down. No backroom plan to monetize. No investor return to deliver. No paid tier ever.
- **Privacy-respecting.** Zero telemetry. Zero tracking. No analytics product, no install ping, no usage metrics phoned home. What you do in Nanocoder stays in Nanocoder.
- **Local-first.** Designed so the whole loop can run on your machine. Seven local server integrations documented as first-class providers, not as power-user escape hatches.

The features below are how those three purposes show up in practice.

## Who we compare against

Seven tools, picked to cover the realistic alternatives a developer chooses between when they want a terminal coding agent:

- **Claude Code** (Anthropic) - proprietary, the dominant polished CLI
- **OpenAI Codex CLI** - OpenAI's official CLI agent
- **Gemini CLI** (Google) - Google's official CLI agent
- **Aider** - long-running OSS agent, file-edit oriented
- **OpenCode** (anomalyco / formerly sst) - the closest OSS peer to Nanocoder
- **Crush** (Charmbracelet) - Go TUI, single-binary distribution
- **Pi** (pi.dev / pi-mono) - minimalist OSS agent with a strong extension API

Cursor, Cline, Continue, and Copilot Chat are excluded on purpose. They are IDE-native and play a different game.

## The dimensions

Twelve axes grouped into four buckets:

- **Positioning / cost**: license, pricing model, vendor lock-in
- **Capability**: local model support, MCP, custom commands / extensibility, tool-calling approach, subagents / scheduled runs
- **Surface**: interface, plain / non-TTY mode for CI
- **Project signals**: GitHub stars, contributors, language / runtime, telemetry posture

## Comparison matrix

### Positioning / cost

| Tool | License | Pricing | Multi-provider |
|---|---|---|---|
| **Nanocoder** | **MIT** | **Free, BYO key, no paid tier ever** | **Yes (20+ providers: see below)** |
| Claude Code | Proprietary | Subscription ($20-$200+/mo) or BYO key | Any Anthropic-API-compatible endpoint via `ANTHROPIC_BASE_URL` (Anthropic, Bedrock, Vertex, Z.ai, Kimi, GLM, custom proxies) |
| Codex CLI | Apache-2.0 | BYO key or ChatGPT plan | OpenAI-first; OpenAI-compatible providers configurable |
| Gemini CLI | Apache-2.0 | Free tier with Google sign-in, BYO key, Vertex | Google-only |
| Aider | Apache-2.0 | Free, BYO key | Yes (OpenAI, Anthropic, Google, Bedrock, Vertex, OpenAI-compatible) |
| OpenCode | MIT | Free + optional paid Zen / Go tiers | Yes (75+ providers) |
| Crush | FSL-1.1-MIT | Free, BYO key | Yes (many providers) |
| Pi | MIT | Free, BYO key or OAuth (Claude / ChatGPT / Copilot) | Yes (20+ providers) |

Nanocoder's provider list is the broadest of any community-led project here:

- **Native cloud**: Anthropic, Atlas Cloud, ChatGPT / Codex, Google Gemini, GitHub Copilot, GitHub Models, Kimi Code, MiniMax Coding, Mistral, OpenAI, OpenRouter, Poe, Requesty, Z.ai, Z.ai Coding
- **Local**: Ollama, llama.cpp, llama-swap, LM Studio, LocalAI, MLX Server, vLLM
- **Custom**: any OpenAI-compatible endpoint

OpenCode lists more total providers in aggregate, but Nanocoder is the only tool with this many *first-class local* servers documented.

### Ownership and governance

This is the metric most other comparisons skip. It matters: who owns the project decides whether it stays free, stays open, stays private, and whose interests it serves five years from now.

| Tool | Owner | Backing | Monetization model | Long-term incentive |
|---|---|---|---|---|
| **Nanocoder** | **Nano Collective (community)** | **None - not-for-profit** | **None - no paid tier, no upsell, no growth target** | **Serve the community that uses it** |
| Claude Code | Anthropic | VC-backed (Google, Amazon; multi-billion valuation) | Subscription + API revenue | Grow Anthropic API usage |
| Codex CLI | OpenAI | VC-backed (Microsoft; multi-hundred-billion valuation) | Subscription + API revenue | Grow OpenAI API usage |
| Gemini CLI | Google / Alphabet | Public company | API revenue + Google Cloud pull-through | Grow Gemini + Vertex usage |
| Aider | Paul Gauthier (solo / independent) | None documented | None (donations) | Maintainer's discretion |
| OpenCode | anomalyco (formerly SST) | Venture-backed company | Paid Zen / Go tiers | Convert free users to paid |
| Crush | Charmbracelet | Private company (VC-backed) | Free CLI; commercial parent now sells Charm Hyper coding-model subscriptions | Strengthen Charm brand and Hyper pipeline |
| Pi | Mario Zechner (solo, via Earendil Inc.) | No disclosed VC | None | Maintainer's discretion |

Nanocoder is the only project in this survey that is **collectively owned, non-profit, with no paid tier and no growth metric to feed**. There is no backroom plan to monetize, no investor expecting a return, no eventual freemium split, no telemetry product hiding inside the binary. The project exists because the community wants it to.

### Capability

| Tool | Local models | MCP | Extensibility | Tool calling | Subagents / scheduled |
|---|---|---|---|---|---|
| **Nanocoder** | **7 local servers (Ollama, llama.cpp, llama-swap, LM Studio, LocalAI, MLX, vLLM)** | **Client** | **Slash + custom markdown commands, custom tools, Skills (bundles + flat-file), MCP, LSP, runtime model tuning** | **Native function calling + XML fallback + JSON fallback (both fallbacks with malformed-output repair)** | **Subagents + cron scheduler + event-driven triggers via per-project daemon** |
| Claude Code | None (cloud only) | Client | Slash commands, Skills, Hooks, Agent SDK | Native | Subagents + Routines (cloud cron) |
| Codex CLI | Via OpenAI-compatible config | Client | Slash commands, AGENTS.md, Skills, lifecycle hooks | Native | Subagents; no cron |
| Gemini CLI | Not documented | Client | Custom commands, Extensions, tools, hooks | Native | Subagents; no scheduler |
| Aider | Ollama, LM Studio, llama.cpp | None | Slash commands only | Diff / text formats (no native function calling) | None |
| OpenCode | Ollama, LM Studio, llama.cpp | Client | Markdown slash commands, plugins, custom tools | Native | Subagents; no cron |
| Crush | Ollama, LM Studio via OpenAI-compatible | Client (stdio / http / sse) | Agent Skills | Native | None built-in |
| Pi | Ollama, OpenAI-compatible | None (deliberate non-goal) | TypeScript extension API | Native | Explicit non-goal |

Nanocoder is the **only tool in this survey that combines all four** of: deep local-model support, MCP, subagents, and scheduled runs. Claude Code comes closest, but its scheduler is cloud-only and it has no local model story. Codex CLI, Gemini CLI, and OpenCode ship subagents but no local scheduler. Nanocoder also goes further on the trigger side: a per-project daemon (`nanocoder daemon start`) owns file-watch and cron sources, so Skills can subscribe to `file.changed` or `schedule.cron` events and run headless without the TUI being open.

### Workflow features

Beyond the headline capability axes, Nanocoder ships the kind of day-to-day workflow features usually only seen in paid proprietary tools:

| Feature | Nanocoder | Claude Code | Codex CLI | Gemini CLI | Aider | OpenCode | Crush | Pi |
|---|---|---|---|---|---|---|---|---|
| Checkpointing (snapshot / restore) | Yes | Yes | Partial | Yes | Via git | Partial | No | No |
| Context compression | Yes | Yes | Yes | Yes | Partial | Yes | Yes | Yes |
| Session autosave + resume | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Task management (built-in) | Yes | Yes | Partial | Partial | No | Partial | No | No |
| File explorer (interactive) | Yes | No | No | No | No | Partial | No | No |
| Desktop notifications | Yes | Yes | Partial | Yes | Yes | Partial | Yes | No |
| Runtime model tuning | Yes | No | Partial | No | No | No | No | No |
| Live diff preview (VS Code) | Yes | Yes | Yes | Yes | Third-party | Partial | No | No |
| Plan mode (preview without execution) | Yes | Yes | Yes | Yes | No | Yes | No | No |

Runtime model tuning at this scope (changing tool profiles, compaction strategy, native-tool-calling toggle, and model parameters at runtime) is unique to Nanocoder among the tools surveyed. Codex CLI is the only other tool that exposes any runtime parameter controls, and only for reasoning effort and verbosity.

### Surface

| Tool | Interface | Plain / non-TTY |
|---|---|---|
| **Nanocoder** | TUI (Ink), VS Code extension with live diffs, ACP agent for editor integration, `--plain` shell | Yes (`--plain`, `run` subcommand) |
| Claude Code | TUI, VS Code, Cursor, JetBrains, Desktop, Web, iOS, Slack | Yes (`claude -p`) |
| Codex CLI | Rust TUI, IDE extensions, Desktop, Web | Yes (`codex exec`) |
| Gemini CLI | TUI, VS Code companion, ACP IDE integration | Yes (`-p` with JSON output) |
| Aider | TUI, experimental browser, voice | Yes (`--message`, Python API) |
| OpenCode | TUI, web UI, desktop, IDE plugins | Yes (`opencode run`) |
| Crush | TUI only | Yes (`crush run`) |
| Pi | TUI with print / JSON / RPC / SDK modes | Yes (`-p`, `--mode json`, stdin, `--offline`) |

### Project signals

Star and contributor counts are resolved from the GitHub API by the docs site when this page is built and cached for one hour. They reflect the state of each repo at the last docs deploy.

| Tool | Stars | Contributors | Language | Telemetry |
|---|---|---|---|---|
| **Nanocoder** | <!--stars:Nano-Collective/nanocoder-->1.9k<!--/stars--> | <!--contributors:Nano-Collective/nanocoder-->51<!--/contributors--> | TypeScript / Node | **None - zero telemetry, zero tracking** |
| Claude Code | <!--stars:anthropics/claude-code-->125k<!--/stars--> | <!--contributors:anthropics/claude-code-->52<!--/contributors--> | Shell wrapper, closed core | Opt-out (Anthropic default) |
| Codex CLI | <!--stars:openai/codex-->84k<!--/stars--> | <!--contributors:openai/codex-->451<!--/contributors--> | Rust | Opt-in OpenTelemetry (off by default) |
| Gemini CLI | <!--stars:google-gemini/gemini-cli-->104k<!--/stars--> | <!--contributors:google-gemini/gemini-cli-->675<!--/contributors--> | TypeScript / Node | Opt-in (disabled by default) |
| Aider | <!--stars:Aider-AI/aider-->45k<!--/stars--> | <!--contributors:Aider-AI/aider-->181<!--/contributors--> | Python | Opt-in; excludes code, chat, keys |
| OpenCode | <!--stars:anomalyco/opencode-->163k<!--/stars--> | <!--contributors:anomalyco/opencode-->917<!--/contributors--> | TypeScript (Bun) | Under-documented; treat as opt-out |
| Crush | <!--stars:charmbracelet/crush-->24k<!--/stars--> | <!--contributors:charmbracelet/crush-->118<!--/contributors--> | Go | Opt-out; honors DO_NOT_TRACK |
| Pi | <!--stars:earendil-works/pi-->52k<!--/stars--> | <!--contributors:earendil-works/pi-->212<!--/contributors--> | TypeScript / Node | Opt-out version check + install ping |

## Why Nanocoder

The matrix tells the structural story. This section tells the human one. The first three points are the project's three purposes, in equal weight. Everything after that is how those purposes show up as capability.

### 1. Community-driven by design

The Nano Collective owns Nanocoder. There are no investors waiting for a return, no eventual freemium split, no paid tier on the roadmap. [Governance](https://docs.nanocollective.org/collective/organisation/governance) and the [Economics Charter](https://docs.nanocollective.org/collective/organisation/economics-charter) are published, so the contribution model is written down before you decide to invest your time. Every other tool in this survey is either a private company's product (Claude Code, Codex, Gemini, OpenCode, Crush) or a single maintainer's project (Aider, Pi). Nanocoder is the only collectively-owned, non-profit option.

What this means in practice: the project's incentives are aligned with the people who use it, not with a growth metric or an eventual liquidity event. Decisions get made in public. There is no roadmap item to convert you to a paid plan, because there is no paid plan.

### 2. Privacy-respecting by design

**Zero telemetry. Zero tracking. No analytics product, no install ping, no usage metrics phoned home.** The binary does not call out to anything you did not ask it to call out to. Compare that to the rest of the field: Anthropic and OpenAI's default postures are not transparent in their public repos; OpenCode's telemetry posture is under-documented; even Crush and Pi ship opt-out version checks and install pings.

If you are running Nanocoder against a local model, the entire loop can run with zero outbound network traffic. What you do in Nanocoder stays in Nanocoder.

### 3. Local-first by design

Aider, OpenCode, and Crush will run against a local model. Nanocoder is built around the assumption that you might want to. Seven local server integrations (Ollama, llama.cpp, llama-swap, LM Studio, LocalAI, MLX Server, vLLM) are documented as first-class providers, not power-user hacks buried in a config schema. The Nano Collective also publishes [Nanotune](https://docs.nanocollective.org/nanotune), an interactive fine-tuning CLI for Apple Silicon, which is the supply side of the same philosophy: smaller local models that are actually good at coding.

If your laptop has the silicon, you can run the entire loop without sending a token anywhere.

### 4. The broadest provider matrix in any OSS terminal agent

20+ providers, native integrations for the ones that matter (Anthropic, Google, OpenAI, OpenRouter, Copilot, Kimi, Mistral, MiniMax, Z.ai, GitHub Models, Poe, ChatGPT / Codex), and a custom OpenAI-compatible escape hatch for everything else. You are not locked into one vendor's pricing, one vendor's model quality cycle, or one vendor's outage.

OpenCode lists more raw providers, but Nanocoder is the broadest project that is not venture-backed and has no paid tier in the loop.

### 5. Works with models of all shapes and sizes

Nanocoder ships three tool-calling paths: native function calling for modern models, an XML fallback, and a JSON fallback, with malformed-output repair on both fallback paths. The conversation loop detects what the model supports and routes accordingly; if the model emits broken XML or JSON, the parser repairs it instead of failing the turn. The practical result: small local models, older models, fine-tuned models, and models that simply do not implement function calling reliably all still work end to end.

Aider achieves something analogous with its diff formats. No other tool in this survey ships all three paths plus repair.

### 6. Local scheduler, subagents, and event-driven Skills

A cron-driven scheduler (powered by `croner`) runs agent sessions on a schedule. Subagents delegate focused tasks to isolated contexts. **Skills** unify both of the above with file-based extensions: a Skill is either a single `.md` file in `.nanocoder/commands|agents|tools/` or a bundle under `.nanocoder/skills/<name>/` that ships a command, subagent, and scoped tools together. Skills can declare a `subscribe:` block in frontmatter to fire on `file.changed` or `schedule.cron` events.

These triggers are owned by a **per-project daemon** (`nanocoder daemon start`, with launchd plist and systemd user-unit installers shipped in-tree), which runs Skills in a non-interactive `headless` mode independent of the TUI. Among the tools surveyed, only Claude Code ships a comparable scheduler — and it is cloud-only, tied to a paid subscription, and has no event-driven file-watch story.

### 7. Workflow features usually gated behind paid tools

Checkpointing (snapshot and restore conversation state), context compression (manage token usage in long sessions), session autosave + resume, task management, an interactive file explorer, desktop notifications, plan mode, and runtime model tuning. Runtime model tuning, in particular, is unique to Nanocoder: you can change tool profiles, the compaction strategy, native-tool-calling, and model parameters live during a session.

### 8. VS Code extension with live diffs

The companion VS Code extension shows live diff previews of agent edits in the editor while the conversation runs in the terminal. Among OSS peers, Gemini CLI's VS Code companion ships a comparable native diff viewer; OpenCode's official extension does not (only a third-party extension does).

### 9. Editor interoperability via ACP

Nanocoder runs as an [Agent Client Protocol](https://agentclientprotocol.com) agent (`nanocoder --acp`), exposing its conversation, tool-calling, and permission flows over the protocol so any ACP-compatible editor (Zed and others) can drive it directly. This is the same standard Gemini CLI uses for its IDE integration, so Nanocoder plugs into that ecosystem rather than needing a bespoke extension per editor. Among the tools surveyed, Nanocoder and Gemini CLI are the two that speak ACP.

## Per-tool notes

### Claude Code

The polished proprietary benchmark. Strongest surface area of any tool here (TUI, VS Code, Cursor, JetBrains, Desktop, Web, iOS, Slack). Cloud-only, closed source. Multi-provider in practice: `ANTHROPIC_BASE_URL` lets you point it at any Anthropic-API-compatible endpoint (Bedrock, Vertex, Z.ai, Kimi, GLM, custom proxies), so it is not strictly locked to Anthropic the company. The constraint is the API shape, not the vendor. Routines (cloud cron) is a real feature Nanocoder's local scheduler echoes. Picks itself if you are happy inside the Anthropic API surface and want zero friction.

### OpenAI Codex CLI

Rust rewrite of the original TypeScript Codex. OpenAI-first but technically multi-provider via `model_providers` config. Good CI story with `codex exec`. Local model support exists but is power-user config, not a headline. Picks itself if you live in the OpenAI ecosystem and want OSS.

### Gemini CLI

Free tier on a personal Google account is genuinely useful. Google-only. Best documented telemetry posture of the big three (opt-in, off by default). No local model support. Picks itself if you are happy on Gemini and want a generous free tier.

### Aider

The veteran. Multi-provider, real local model support, mature workflow around `git` and edit formats. No MCP, no subagents, no plugin system, no native function calling. The diff edit format works on weaker models that cannot tool-call. Picks itself if you want a stable, opinionated, edit-focused tool.

### OpenCode

The closest direct competitor on every feature axis: OSS, multi-provider, local models, MCP, plugins, subagents, native tool calling, TUI plus web plus desktop. Much larger community (~163k stars). Has a paid vendor tier (Zen / Go). Owned by a venture-backed company; community involvement is structured around that. Picks itself if you want the most feature-complete OSS option and do not mind the governance model.

### Crush

Go single-binary, polished Charm aesthetic, multi-provider, MCP client with three transports. Ships a non-interactive `crush run` mode and desktop notifications, but no subagents, no scheduler, and few of the deeper workflow features (no checkpointing, no task list, no plan mode). Picks itself if you value a single-binary install and TUI polish over breadth.

### Pi

Deliberately minimalist: four built-in tools, a system prompt under ~1,000 tokens (including tool definitions), no MCP, no subagents, no scheduler. Compensates with the deepest extension API of the set (TypeScript). Picks itself if you want a small, hackable core and are willing to write your own extensions.

## Where Nanocoder is honestly behind

This is real and worth being clear about.

- **Community size.** OpenCode (~163k stars), Claude Code (~125k), Gemini CLI (~104k), Codex (~84k), Pi (~52k), Aider (~45k), Crush (~24k) all sit above Nanocoder today. Growth and contribution velocity matter more than absolute count, but the gap exists.
- **Surface breadth.** Claude Code, Codex, and OpenCode ship desktop and / or web surfaces. Nanocoder is TUI plus VS Code plus ACP plus `--plain`. Enough for most CLI users, not all.
- **Extension depth.** Pi's TypeScript extension API is still deeper and more programmable than Nanocoder's file-based Skills + MCP + custom-tools combination. Claude Code's Hooks system (process-level event hooks) also has no direct Nanocoder equivalent; Nanocoder's event story runs through Skill `subscribe:` blocks via the daemon, not arbitrary user-defined shell hooks on the agent lifecycle.
- **Distribution polish.** Crush's single Go binary is smoother than Node + pnpm. Nanocoder mitigates with Homebrew and Nix Flakes.

Everywhere else, Nanocoder is at parity or ahead.

## Where Nanocoder is at parity

- **Multi-provider support.** Matched by Aider, OpenCode, Crush, Pi.
- **MCP client support.** Matched by Claude Code, Codex, Gemini, OpenCode, Crush.
- **OSS license.** Matched by Codex, Gemini, Aider, OpenCode, Crush, Pi.
- **Plain / non-TTY mode for CI.** Matched by Claude Code, Codex, Gemini, Aider, OpenCode, Crush, Pi.
- **Native tool calling.** Matched by every tool except Aider.

## Who Nanocoder is for

- Developers who want their tools owned by the community that uses them, not by a private company with investors to answer to.
- Developers who want zero telemetry and zero tracking, not opt-out toggles to remember to flip.
- Developers who want to run agentic coding against local models without giving up modern capabilities (MCP, subagents, scheduling, checkpointing).
- Developers who refuse vendor lock-in and want a single tool that talks to 20+ providers, including small local and fine-tuned models that other tools quietly drop.
- Developers willing to trade some surface-area polish (no desktop or web app yet) for breadth, control, privacy, and community.

If that is you, Nanocoder is the right pick. If you want the most polished proprietary experience and are happy paying for it, Claude Code is honest about being that. If you want the most feature-complete OSS tool and do not mind venture-backed governance, OpenCode is honest about being that. We think Nanocoder is the honest answer for everyone else.

## Maintenance

Star counts, contributor counts, feature lists, and pricing change. Re-verify before quoting externally. Sources used for the initial draft:

- Claude Code: anthropic.com/claude-code, claude.ai/code, official pricing pages
- Codex CLI: github.com/openai/codex, developers.openai.com/codex/cli
- Gemini CLI: github.com/google-gemini/gemini-cli (telemetry, model, headless docs)
- Aider: aider.chat/docs
- OpenCode: opencode.ai/docs, github.com/anomalyco/opencode
- Crush: github.com/charmbracelet/crush
- Pi: pi.dev, github.com/earendil-works/pi
- Nanocoder: docs.nanocollective.org/nanocoder
