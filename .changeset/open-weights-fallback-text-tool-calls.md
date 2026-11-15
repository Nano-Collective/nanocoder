---
"@nanocollective/nanocoder": patch
---

Enable fallback text-based tool-call parsing (`whenever-no-native` policy) in `runPlainConversation`, `runAcpConversation`, and `runSubagentLoop`. Open-weights models (such as Qwen 2.5 Coder, Llama, and DeepSeek) running against OpenAI-compatible local backends (e.g. llama.cpp, Ollama) often emit function calls as text-based XML or JSON blocks rather than native SDK tool chunks; without this policy, tool calls in headless runs, subagent delegations, and ACP sessions were silently treated as plain text and never executed.
