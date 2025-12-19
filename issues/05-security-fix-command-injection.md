# Fix command injection vulnerabilities in shell commands

## Priority: High (Security)

## Description

Several files construct shell commands using string concatenation, which could allow command injection if user input isn't properly sanitized.

## Affected Files

### 1. `source/lsp/server-discovery.ts:154`
```typescript
execSync(`which ${command}`, {stdio: 'ignore'});
```

### 2. `source/tools/find-files.tsx:77,88,92,95`
```typescript
findCommand = `find . -name "${namePattern}"`;
```

### 3. `source/tools/search-file-contents.tsx:68,74`
```typescript
const escapedQuery = query.replace(/"/g, '\\"');
// Only escapes double quotes, misses other shell metacharacters
```

## Proposed Solution

Use array-based arguments with `spawn()` or `execFile()` instead of shell string concatenation:

```typescript
// Before
execSync(`which ${command}`, {stdio: 'ignore'});

// After
import { execFileSync } from 'node:child_process';
execFileSync('which', [command], {stdio: 'ignore'});
```

For find/grep commands, use the array form:

```typescript
// Before
const {stdout} = await execAsync(`find . -name "${pattern}"`);

// After
import { spawn } from 'node:child_process';
const proc = spawn('find', ['.', '-name', pattern]);
```

## Acceptance Criteria

- [ ] All shell commands use array-based arguments
- [ ] No string concatenation for command construction
- [ ] Shell metacharacters cannot escape command context
- [ ] Existing functionality preserved
- [ ] Tests verify commands work with special characters in input
