# Fail fast on missing API key instead of using dummy

## Priority: High (Security)

## Description

When an API key is not configured, the code falls back to `'dummy-key'` which masks configuration errors. Users don't discover the problem until the API call fails with an auth error.

## Affected Files

- `source/client-factory.ts:132`
- `source/ai-sdk-client.ts:412`

```typescript
apiKey: provider.apiKey || 'dummy-key',
```

## Proposed Solution

Fail fast with a clear error message:

```typescript
if (!provider.apiKey) {
    throw new Error(
        `API key required for provider "${provider.name}". ` +
        `Set it in agents.config.json or via environment variable.`
    );
}
```

Or for providers that may not need keys (local models):

```typescript
apiKey: provider.apiKey || (provider.requiresAuth ?
    throwMissingApiKeyError(provider.name) :
    undefined),
```

## Acceptance Criteria

- [ ] Missing API key throws clear error at configuration time
- [ ] Error message explains how to fix the issue
- [ ] Local providers (Ollama, LM Studio) still work without API key
- [ ] Tests verify error is thrown for providers requiring auth
