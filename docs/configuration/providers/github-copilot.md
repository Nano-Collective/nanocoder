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
2. Log in via GitHub's device OAuth flow, either inside Nanocoder with `/copilot-login [provider-name]` or from a shell with `nanocoder copilot login [provider-name]`
3. Credentials are cached locally and refreshed automatically

Credentials are stored under the provider name you log in with, and looked up by the exact `name` of the provider entry. Both commands default to `GitHub Copilot`, as does the `/settings providers` wizard. If you name the provider something else, pass the same name when logging in, for example `nanocoder copilot login "Work Copilot"`.

## Notes

- No API key is required. Authentication is handled via GitHub's device OAuth flow
- Available models depend on your Copilot subscription tier
