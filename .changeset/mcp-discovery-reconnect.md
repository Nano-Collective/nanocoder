---
"@nanocollective/nanocoder": patch
---

Fixed on-demand MCP tool discovery after a server reconnects. When an unhealthy server recovered, Nanocoder registered every one of its tools at once and dropped them from the catalog, so a discovery-mode session ended up sending every schema in every request. A recovered server now goes back into the catalog, and only the tools the model had already loaded come back. Calling a catalog tool before loading it now tells the model to call `load_tool_schema` first, instead of saying the tool does not exist.
