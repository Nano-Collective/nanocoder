---
"@nanocollective/nanocoder": patch
---

Fixed the automatic XML fallback for models that reject native tool calling. When a server refused tools (for example Ollama's "does not support tools"), the error was not recognised, because a refused streamed request only carries the server's message on the stream error. Nanocoder now reads that message, retries the request with XML tool definitions in the system prompt (before, the retry told the model to use XML tool calls without listing any tools), and remembers the model for the rest of the session, so later turns skip the failing request. Errors about tool calls in the conversation history, such as OpenAI's "messages with role 'tool' must be a response to a preceding message with 'tool_calls'", are no longer mistaken for missing tool support, so they show as the real error instead of silently switching the session to XML.
