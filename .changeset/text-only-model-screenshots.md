---
"@nanocollective/nanocoder": patch
---

A local text-only model no longer gets stuck after a browser screenshot. Screenshots were withheld only from models that models.dev lists without image input, so most Ollama and llama.cpp models were sent them, and once the server refused the image every later request failed on the same screenshot in history. When a provider now rejects a request for carrying images, the request is retried once with the images replaced by a short note, and that model gets no images for the rest of the session. Local vision models that accept images keep receiving them.
