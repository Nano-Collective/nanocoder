---
title: "GMI Cloud"
description: "Set up GMI Cloud as an OpenAI-compatible provider in Nanocoder"
sidebar_order: 19
---

# GMI Cloud

This preset uses GMI Cloud's [OpenAI-compatible Chat Completions API](https://docs.gmicloud.ai/inference-engine/api-reference/llm-api-reference#create-chat-completion).

Create an inference API key in the [GMI Cloud console](https://console.gmicloud.ai/) under **Organization Settings → API Keys**.

## Wizard setup

1. Run `/settings providers` in Nanocoder. Choose global configuration to keep your key out of the project.
2. Choose the **GMI Cloud** template and enter your API key. The wizard masks the key and fetches the available models.
3. Select one or more models from the list GMI Cloud returns for your key. If discovery fails, enter an exact model ID manually. The wizard does not prefill a model.
4. Choose **Done & Save**, then press Enter to confirm.

## Manual setup

Set `GMI_API_KEY` in your environment before starting Nanocoder. Add this entry to `nanocoder.providers` in [`agents.config.json`](../index.md):

```json
{
  "name": "GMI Cloud",
  "baseUrl": "https://api.gmi-serving.com/v1",
  "apiKey": "${GMI_API_KEY}",
  "models": ["YOUR_MODEL_ID"]
}
```

Replace `YOUR_MODEL_ID` with an exact model ID. Use the wizard to see the models available to your key, or check the [GMI Cloud text model catalog](https://docs.gmicloud.ai/model-quickstarts/text/overview). Keep `/v1` at the end of `baseUrl`; Nanocoder adds `/models` and `/chat/completions` as needed.
