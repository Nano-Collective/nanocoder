---
title: "Atomic Chat"
description: "Configure Atomic Chat as a local AI provider for Nanocoder"
sidebar_order: 4
---

# Atomic Chat

[Atomic Chat](https://atomic.chat) is a desktop application for running local models with a built-in OpenAI-compatible API server at `http://127.0.0.1:1337/v1`.

## Configuration

```json
{
	"name": "Atomic Chat",
	"baseUrl": "http://127.0.0.1:1337/v1",
	"apiKey": "atomic",
	"models": ["your-model-name"]
}
```

The `apiKey` field is optional for local use; Atomic Chat accepts the placeholder value `"atomic"` when a key is required by the client.

## Setup

1. Download and install Atomic Chat from [atomic.chat](https://atomic.chat)
2. Load a model in the app
3. Verify the API is running:

```bash
curl http://127.0.0.1:1337/v1/models
```

## Docker

If Nanocoder runs inside a container, use `host.docker.internal` to reach Atomic Chat on the host:

```json
{
	"name": "Atomic Chat",
	"baseUrl": "http://host.docker.internal:1337/v1",
	"apiKey": "atomic",
	"models": ["your-model-name"]
}
```

## Context Length

Load your model with a context length as high as your system's memory can handle. Agentic coding needs enough context to track conversation history, tool calls, and file contents. Increase context in Atomic Chat's model settings before starting a session.

## Fetching Available Models

The `/setup-providers` wizard can automatically fetch your loaded models from Atomic Chat when configuring this provider.
