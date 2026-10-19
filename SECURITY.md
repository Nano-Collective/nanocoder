# Security Policy

Thank you for helping keep Nanocoder and its users safe.

This policy covers the Nanocoder CLI, the VS Code extension, and the packages we publish (npm, Homebrew and Nix).

## Supported versions

We fix security issues in the **latest release** only. Please upgrade before reporting, or check that the issue
still exists on the latest release. Reports about unreleased code on `main` are welcome too: catching a problem
before it ships is the best outcome.

## Reporting a vulnerability

**Please do not open a public issue, discussion or pull request for a security problem.**

Report it privately through GitHub:

1. Open the [Security tab](https://github.com/Nano-Collective/nanocoder/security) of this repository.
2. Choose **Report a vulnerability**
   (or go straight to [the report form](https://github.com/Nano-Collective/nanocoder/security/advisories/new)).

Please include:

- the Nanocoder version or commit, your operating system and Node version;
- what you expected to happen and what happened instead;
- steps to reproduce, ideally with a **harmless** proof of concept (marker files, fake tokens, local servers).
  Please do not test against real accounts, real credentials or systems you do not own;
- the impact as you understand it, and a suggested fix if you have one.

If you cannot use GitHub's form, ask in our [Discord](https://discord.gg/ktPDV6rekE) for a private way to reach a
maintainer. **Please do not post any details of the issue there.**

## What to expect

We are a small team, so we cannot promise fixed timelines, but we will:

- acknowledge your report and tell you whether we can reproduce it;
- keep you updated while we work on a fix, in private;
- release the fix, then publish a security advisory;
- credit you in the advisory and release notes unless you prefer to stay anonymous.

Please give us a reasonable chance to ship a fix before you disclose the issue publicly.

## What counts as a vulnerability

Examples we want to hear about:

- code in a folder you have **not** trusted running, or its configuration being loaded, without the directory trust
  prompt (for example through `run`, `verify`, the daemon, or `--acp`);
- a tool running without the approval its mode requires, or a way to get past the allow-lists used by `verify`,
  the daemon or subagents;
- path-containment or sandbox escapes in the file tools, `execute_bash` or the OS sandbox;
- secrets (API keys, tokens) being sent somewhere they should not go, or written to logs or session files;
- content you did not choose to run (a pull request, a web page, a file, tool output) making Nanocoder take an action
  your approval settings should have blocked.

## What does not count

These are by design:

- Code in a folder **you chose to trust** runs with your permissions. That includes hooks, plugins, formatters,
  custom tools, skills, and MCP servers declared in `agents.config.json`, `.mcp.json` and `.nanocoder/`. Trusting a
  folder means trusting what is in it; see [Hooks and plugins](docs/features/hooks.md#security) and the
  [directory trust prompt](docs/getting-started/index.md).
- `yolo` mode runs every tool without asking.
- Mistakes, hallucinations or unsafe suggestions from the language model itself.
- Vulnerabilities in third-party providers, MCP servers, or other dependencies that we do not control. Please report
  those upstream (we are happy to help coordinate).

If you are unsure whether something qualifies, report it anyway.
