---
title: "Development Modes"
description: "Normal, auto-accept, and plan modes for controlling tool execution"
sidebar_order: 4
---

# Development Modes

Nanocoder has three development modes that control how tool executions are handled. Toggle between modes with **Shift+Tab** during a chat session.

## Normal Mode

The default mode. Every tool call requires your explicit confirmation before execution.

- Review potentially dangerous tool calls before they run
- Best for unfamiliar codebases or sensitive operations
- Gives you full control over what changes are made

## Auto-Accept Mode

Automatically accepts and executes all tool calls without confirmation.

- Faster workflows when you trust the AI's actions
- Useful for well-understood tasks like code generation or refactoring
- All tool execution results are still displayed

## Plan Mode

The AI suggests actions and tool calls but does not execute them.

- Useful for planning and exploration
- See what the AI would do without making any changes
- Great for understanding the AI's approach before committing to it
