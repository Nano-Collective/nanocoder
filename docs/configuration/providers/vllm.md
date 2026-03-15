---
title: "vLLM"
description: "Configure vLLM as a local AI provider for Nanocoder"
sidebar_order: 5
---

# vLLM

[vLLM](https://github.com/vllm-project/vllm) is a high-throughput and memory-efficient inference engine with an OpenAI-compatible API server.

## Configuration

```json
{
	"name": "vLLM",
	"baseUrl": "http://localhost:8000/v1",
	"models": ["local-model"]
}
```

No API key is required for local use.

## Setup

```bash
pip install vllm
vllm serve model-name --port 8000
```

## Context Length

Set the maximum model length as high as your system's memory can handle when launching:

```bash
vllm serve model-name --max-model-len 32768
```
