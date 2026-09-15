---
"@nanocollective/nanocoder": patch
---

fix(config): preserve MCP source field to enable project-level security validation

The validateProjectConfigSecurity function now correctly validates project-level MCP configs for hardcoded credentials. Previously, the .source field was being stripped during config unwrapping, causing the security check to never run.
