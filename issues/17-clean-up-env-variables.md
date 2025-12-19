# Clean up environment variable documentation

## Priority: Low

## Description

The `.env.example` file has inconsistencies with actual usage in the codebase.

## Issues Found

### Undocumented variables (used but not in .env.example)
- `NANOCODER_INSTALL_METHOD` - Used in `source/utils/installation-detector.ts`
- `NANOCODER_LOG_DISABLE_FILE` - Used in `source/utils/logging/config.ts`
- `NANOCODER_CORRELATION_DEBUG` - Used in `source/utils/logging/correlation.ts`
- `NANOCODER_CORRELATION_ENABLED` - Used in `source/utils/logging/correlation.ts`

### Unused variables (in .env.example but never used)
- `API_BASE_URL` - Listed but not referenced in codebase
- `PREFERRED_MODEL` - Listed but not referenced in codebase

## Proposed Solution

1. Add documentation for undocumented variables:

```bash
# Installation method override (npm, homebrew, nix)
# NANOCODER_INSTALL_METHOD=npm

# Logging configuration
# NANOCODER_LOG_DISABLE_FILE=true
# NANOCODER_CORRELATION_DEBUG=true
# NANOCODER_CORRELATION_ENABLED=true
```

2. Remove unused variables or implement them if intended

## Acceptance Criteria

- [ ] All used environment variables documented in .env.example
- [ ] Unused variables removed or implemented
- [ ] Variables grouped logically with comments
- [ ] Each variable has a description comment
