---
title: "Google Gemini"
description: "Configure Google Gemini as a native AI provider for Nanocoder"
sidebar_order: 21
---

# Google Gemini

Use Google's Gemini models with native API support via `@ai-sdk/google`.

## Configuration

```json
{
	"name": "Gemini",
	"sdkProvider": "google",
	"baseUrl": "https://generativelanguage.googleapis.com/v1beta",
	"apiKey": "your-gemini-api-key",
	"models": ["your-model-name"]
}
```

The `sdkProvider: "google"` field enables the native Google SDK, which is required for Gemini 3 models with tool calling support.

## Setup

1. Get an API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
