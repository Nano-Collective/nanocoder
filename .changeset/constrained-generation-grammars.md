---
"@nanocollective/nanocoder": minor
---

Add constrained generation support for local LLM providers (Ollama, vLLM, llama.cpp)

Implements automatic JSON Schema-based constrained generation to enforce valid tool usage at the token-sampling level, eliminating invalid JSON, hallucinated tool names, and incorrect parameter types for small local models.

**New Configuration:**
- Added `constrainedGeneration` field to provider configs with `enableConstrainedGeneration` flag
- Supports provider-specific parameters via `extraBody` escape hatch

**Provider Support:**
- **Ollama**: Uses `format: "json"` parameter
- **vLLM**: Uses `guided_json` with full JSON Schema
- **llama.cpp**: Uses `json_schema` parameter
- **Generic OpenAI-compatible**: Uses `response_format` with `json_schema`

**Implementation:**
- Tool schemas automatically compiled to JSON Schema format
- Provider detection via case-insensitive name matching
- Only activates when tools are present and flag is enabled
- Follows existing OpenRouter pattern for provider-specific options

**Example Configuration:**
```json
{
  "name": "Ollama",
  "baseUrl": "http://localhost:11434/v1",
  "models": ["llama3.1"],
  "constrainedGeneration": {
    "enableConstrainedGeneration": true
  }
}
```

Resolves #1580
