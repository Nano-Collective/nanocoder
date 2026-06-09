---
title: "Introduction"
description: "Nanocoder is a CLI coding agent with multi-provider AI support, built by the Nano Collective"
sidebar_order: 1
---

# Nanocoder

An open coding agent for your terminal, built by a community collective rather than a company. Bring your own model, keep your code on your machine, and owe nothing to anyone.

Built by the [Nano Collective](https://nanocollective.org), a community collective building AI tooling not for profit, but for the community. Nanocoder runs agentic coding on the model of your choice: local models via Ollama, or any OpenAI-compatible API such as OpenRouter, Anthropic, and Google. You decide which provider runs your code and where your data goes.

## What is Nanocoder?

Nanocoder is a CLI coding agent with tool support for file operations and command execution. It works with any AI provider that exposes an OpenAI-compatible endpoint, and supports both tool-calling and non-tool-calling models. Every tool the collective ships aims to be **privacy-respecting**, **local-first**, and **open for all**: no closed-source features, no paid tiers gating the useful parts.

## How is this different to OpenCode?

This comes down to philosophy. Nanocoder is built as a true community-led project, owned by the Nano Collective rather than a company: no investor return to deliver, no paid tier, and no roadmap steered by what monetizes best. Anyone can contribute openly and directly, and the people building it are the people using it. OpenCode is a genuinely good tool, but it is venture-backed, and that ultimately shapes where a project's incentives point. We believe AI is too powerful to sit only in the hands of big corporations, and that everyone should have access to it.

We also strongly believe in the "local-first" approach, where your data, models, and processing stay on your machine whenever possible to ensure maximum privacy and user control. Beyond that, we're actively pushing to develop advancements and frameworks for small, local models to be effective at coding locally.

Not everyone will agree with this philosophy, and that's okay. We believe in fostering an inclusive community that's focused on open collaboration and privacy-first AI coding tools.

## I want to be involved, how do I start?

We would love for you to be involved. You can get started contributing to Nanocoder in several ways, check out the [Community](community.md) page.

## Quick Start

```bash
npm install -g @nanocollective/nanocoder
nanocoder
```

See the [Installation Guide](getting-started/installation.md) for more options including Homebrew and Nix Flakes.
