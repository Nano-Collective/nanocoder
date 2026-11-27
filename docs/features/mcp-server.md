---
title: "MCP Server"
description: "Expose Nanocoder's coding and review tools to MCP clients over stdio"
sidebar_order: 10
---

# MCP Server

Nanocoder can run as a local [Model Context Protocol](https://modelcontextprotocol.io/)
server so another agent can call Nanocoder's coding and review workflows:

```bash
nanocoder mcp serve
```

The server speaks MCP over stdin and stdout. It reserves stdout for protocol
messages; launch it from an MCP client such as Codex rather than as an
interactive command.

## Tools

| Tool | Arguments | Result |
| --- | --- | --- |
| `run_task` | `prompt` (required), `cwd`, `mode`, `model` (optional) | Final response, files changed, tool calls and run status |
| `review_diff` | `request`, `tier`, `cwd`, `model` (optional) | Review status, tier, report and exit code |

`run_task` runs a non-interactive Nanocoder task. Its result includes
`finalText` and `filesChanged`, along with status and execution details.
`filesChanged` lists distinct paths reported by successful built-in file
mutation tools; it does not infer changes made by shell commands or other
tools.
`review_diff` reviews the current branch or working-tree diff by default. Set
`request` to focus the review, and choose `tier` as `grounded`, `quick`, or
`deep` (the default is `grounded`).

Each task defaults to **plan** mode. The server starts with **plan** as its
permission ceiling, so a tool call cannot request a more permissive mode. Use
`--mode <mode>` to raise that ceiling, for example `--mode auto-accept`; this
allows a task to request that mode, but does not change its default from plan.
The directory must be trusted before a tool can run. `--trust-directory`
skips that check for this server process only and does not change the saved
trust list.

The server's launch directory is the project root. A tool's optional `cwd`
must normalize to exactly that directory (`.` is accepted); subdirectories
and other paths are rejected. Set the MCP client's working directory to
select the repository; tool calls cannot switch the server to another
directory. Use `--provider` and `--model` to choose the server's default
provider and model:

```bash
nanocoder mcp serve --provider ollama --model qwen3-coder --mode plan
```

## Connect from Codex CLI

Add a stdio server entry to Codex's `~/.codex/config.toml` (or a trusted
project's `.codex/config.toml`). Set `cwd` to the repository Nanocoder should
work in:

```toml
[mcp_servers.nanocoder]
command = "nanocoder"
args = ["mcp", "serve"]
cwd = "/path/to/your/project"
```

The `nanocoder` executable must be on Codex's `PATH`. `codex mcp list`
confirms that Codex has the server configured; ask Codex to call `run_task` or
`review_diff` to confirm the connection works. You can also register a server
from a terminal with:

```bash
codex mcp add nanocoder -- nanocoder mcp serve
```

For a local source build or a Windows setup without the `nanocoder` shim on
`PATH`, build Nanocoder with `pnpm run build` and configure Codex to launch the
CLI through Node instead. Replace both paths with locations on your machine:

```toml
[mcp_servers.nanocoder]
command = "node"
args = ["C:/path/to/nanocoder/dist/cli.js", "mcp", "serve"]
cwd = "C:/path/to/your/project"
```

If the project is not trusted yet, run `nanocoder trust --status` in that
repository and trust it through Nanocoder before asking Codex to call a tool.

## Configure other MCP clients

Any client that supports local MCP servers over stdio can launch the same
command. Set its working directory to the repository and use `nanocoder` as
the command with `mcp serve` as its arguments. The server reads provider and
project configuration from its launch environment and directory.
