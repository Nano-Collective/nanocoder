---
title: "Development Modes"
description: "Normal, auto-accept, and plan modes for controlling tool execution"
sidebar_order: 10
---

# Development Modes

When the AI needs to take an action — editing a file, running a command, searching your codebase — it makes a **tool call**. Development modes control whether those tool calls require your approval.

Toggle between modes with **Shift+Tab** during a chat session. The current mode is shown in the status bar.

## Normal Mode

The default mode. Every tool call requires your explicit confirmation before execution.

- See exactly what the AI wants to do before it happens
- Approve or reject each action individually
- Best for unfamiliar codebases, sensitive operations, or when you want full control

**When to use:** Starting a new project, working with code you don't fully understand, or when the AI is making changes you want to review carefully.

## Auto-Accept Mode

Automatically accepts and executes all tool calls without confirmation.

- Significantly faster for iterative workflows
- All tool execution results are still displayed — you can see what happened
- The AI can chain multiple actions without waiting for approval

**When to use:** Tasks you trust the AI to handle — code generation, refactoring well-understood code, running tests, or when you want to step back and let the AI work through a problem.

## Plan Mode

The AI describes what it would do and shows tool calls, but nothing executes.

- See the AI's full plan without any changes to your codebase
- Useful for understanding the AI's approach before committing to it
- Switch to Normal or Auto-Accept when you're ready to execute

**When to use:** Exploring how the AI would approach a complex task, reviewing its strategy before making changes, or when you want to understand what tools are available.
