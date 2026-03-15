---
title: "GitHub Copilot"
description: "Configure GitHub Copilot as a native AI provider for Nanocoder"
sidebar_order: 22
---

# GitHub Copilot

Use your existing GitHub Copilot subscription to access AI models through Nanocoder. Authentication is handled via device OAuth flow — no API key needed.

## Configuration

```json
{
	"name": "GitHub Copilot",
	"sdkProvider": "github-copilot",
	"baseUrl": "https://api.githubcopilot.com",
	"models": ["your-model-name"]
}
```

The `sdkProvider: "github-copilot"` field enables the GitHub Copilot authentication flow.

## Setup

1. Ensure you have an active [GitHub Copilot subscription](https://github.com/features/copilot)
2. Run `/copilot-login` inside Nanocoder to authenticate via GitHub's device OAuth flow
3. Credentials are cached locally and refreshed automatically

## Notes

- No API key is required — authentication is handled via GitHub's device OAuth flow
- Available models depend on your Copilot subscription tier
