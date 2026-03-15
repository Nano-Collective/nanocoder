---
title: "LocalAI"
description: "Configure LocalAI as a local AI provider for Nanocoder"
sidebar_order: 6
---

# LocalAI

[LocalAI](https://localai.io) is a self-hosted, OpenAI-compatible API that runs on consumer hardware.

## Configuration

```json
{
	"name": "LocalAI",
	"baseUrl": "http://localhost:8080/v1",
	"models": ["local-model"]
}
```

No API key is required for local use.

## Setup

See the [LocalAI quickstart guide](https://localai.io/basics/getting_started/) for installation options including Docker, binary releases, and package managers.
