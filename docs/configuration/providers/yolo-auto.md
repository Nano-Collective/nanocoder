---
title: "Yolo-Auto"
description: "Configure Yolo-Auto as a cloud AI provider for Nanocoder"
sidebar_order: 27
---

# Yolo-Auto

[Yolo-Auto](https://yolo-auto.com) is an independent OpenAI-compatible LLM API with flat-rate plans and a free tier. Because it speaks the OpenAI Chat Completions API, it works as a drop-in coding provider for Nanocoder.

## Configuration

```json
{
	"name": "Yolo-Auto",
	"baseUrl": "https://yolo-auto.com/v1",
	"apiKey": "${YOLO_AUTO_API_KEY}",
	"models": ["yolo", "yolo-small"]
}
```

## Setup

1. Create an account at [yolo-auto.com](https://yolo-auto.com)
2. Generate a `yolo_...` API key from your [dashboard](https://yolo-auto.com/app)
3. Use the stable model aliases `yolo` and `yolo-small`, or discover the current catalog for your key

The `models` list above is just the stable public aliases. The full, current catalog is discoverable at `GET /v1/models`, and the `/settings providers` wizard can automatically fetch available models from your Yolo-Auto account.

See the [Yolo-Auto docs](https://yolo-auto.com/docs) for plan details and the model catalog.
