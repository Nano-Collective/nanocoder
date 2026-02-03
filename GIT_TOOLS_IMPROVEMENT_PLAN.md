# Git Tools Plan for Nanocoder

## Overview

Replace the existing 4 git tools with 11 focused, well-designed tools that cover the core git operations a coding agent needs.

## Conditional Registration

**Git tools should only be registered if git is installed.**

In `source/tools/index.ts` or `tool-manager.ts`:
```typescript
import { execSync } from 'child_process';

function isGitAvailable(): boolean {
  try {
    execSync('git --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Only include git tools if git is available
const gitTools = isGitAvailable() ? [
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitAddTool,
  gitCommitTool,
  gitPushTool,
  gitPullTool,
  gitBranchTool,
  gitStashTool,
  gitResetTool,
  gitPrTool,
] : [];
```

This saves ~2,000-4,000 tokens when git isn't available.

---

## Tools to Delete

| Current Tool | Reason |
|--------------|--------|
| `git_smart_commit` | Over-engineered. Let the model write commit messages. |
| `git_create_pr` | Only generates templates, doesn't create PRs. Replace with `git_pr`. |
| `git_branch_suggest` | Unnecessary. Model can suggest branch names itself. |
| `git_status_enhanced` | Replace with simpler `git_status`. |

---

## New Tools (11 total)

### Approval Levels

| Level | Behavior |
|-------|----------|
| **ALWAYS_APPROVE** | User must approve even in auto-accept mode |
| **STANDARD** | Requires approval in normal mode, skipped in auto-accept |
| **AUTO** | Never requires approval |

---

### 1. `git_status`

**Purpose**: Show repository status - branch, changes, sync state
**Approval**: AUTO

```typescript
interface GitStatusInput {
  // No parameters - always shows full status
}
```

**Output includes**:
- Current branch
- Upstream tracking branch (if any)
- Ahead/behind count
- Staged files
- Unstaged files
- Untracked files
- Merge/rebase in progress
- Conflicts (if any)

**Formatter**:
```
⚒ git_status
  Branch: feature/git-tools → origin/feature/git-tools
  Sync: 2 ahead, 1 behind
  Staged: 3 files (+45, -12)
  Modified: 2 files
  Untracked: 1 file
```

---

### 2. `git_diff`

**Purpose**: View changes between states
**Approval**: AUTO

```typescript
interface GitDiffInput {
  staged?: boolean;       // Show staged changes (default: false, shows unstaged)
  file?: string;          // Specific file to diff
  base?: string;          // Compare against branch/commit (e.g., "main", "HEAD~3")
  stat?: boolean;         // Show only diffstat summary
}
```

**Features**:
- Truncates diffs >500 lines with summary
- Shows file-by-file breakdown
- Clear +/- formatting

**Formatter**:
```
⚒ git_diff
  Comparing: working tree vs HEAD
  Files: 3 changed
  Stats: +45 insertions, -12 deletions
```

---

### 3. `git_log`

**Purpose**: View commit history
**Approval**: AUTO

```typescript
interface GitLogInput {
  count?: number;         // Number of commits (default: 10, max: 50)
  file?: string;          // History for specific file
  author?: string;        // Filter by author
  since?: string;         // Since date (e.g., "2024-01-01", "1 week ago")
  grep?: string;          // Search commit messages
  branch?: string;        // Show commits on specific branch
}
```

**Output per commit**:
- Short hash
- Author
- Relative date
- Subject line
- Files changed count

**Formatter**:
```
⚒ git_log
  Showing: 10 commits on feature/git-tools
  Range: 2 days ago → 5 minutes ago
```

---

### 4. `git_add`

**Purpose**: Stage files for commit
**Approval**: STANDARD

```typescript
interface GitAddInput {
  files?: string[];       // Specific files/patterns (default: all changed files)
  all?: boolean;          // Stage all including untracked (-A)
  update?: boolean;       // Stage only tracked files (-u)
}
```

**Features**:
- Validates files exist
- Shows what was staged
- Warns about large binary files

**Formatter**:
```
⚒ git_add
  Staging: 3 files
  Files:
    A  src/tools/git/status.tsx
    M  src/tools/index.ts
    M  package.json
```

---

### 5. `git_commit`

**Purpose**: Create a commit
**Approval**: ALWAYS_APPROVE - User should see commit message before creation

```typescript
interface GitCommitInput {
  message: string;        // Commit message (required)
  body?: string;          // Extended description (separate paragraph)
  amend?: boolean;        // Amend previous commit
  noVerify?: boolean;     // Skip pre-commit hooks
}
```

**Features**:
- Validates staged changes exist
- Warns if amending a pushed commit
- Shows full message in formatter

**Formatter**:
```
⚒ git_commit
  Message: "feat(git): add new status tool"
  Body: "Replaces git_status_enhanced with simpler implementation..."
  Staged: 5 files (+120, -45)
  Amend: no
```

---

### 6. `git_push`

**Purpose**: Push commits to remote
**Approval**: ALWAYS_APPROVE - User should see what will be pushed

```typescript
interface GitPushInput {
  remote?: string;        // Remote name (default: origin)
  branch?: string;        // Branch to push (default: current)
  setUpstream?: boolean;  // Set upstream tracking (-u)
  force?: boolean;        // Force push (shows warning)
  forceWithLease?: boolean; // Safer force push
}
```

**Features**:
- Shows commits that will be pushed
- Strong warning for force push
- Validates remote exists

**Formatter**:
```
⚒ git_push
  Remote: origin
  Branch: feature/git-tools → origin/feature/git-tools
  Commits: 3 commits to push
    abc1234 feat(git): add status tool
    def5678 feat(git): add diff tool
    ghi9012 feat(git): add log tool
  Force: no
```

**Formatter (force push)**:
```
⚒ git_push
  ⚠️  FORCE PUSH - This will overwrite remote history!
  Remote: origin
  Branch: feature/git-tools
  ...
```

---

### 7. `git_pull`

**Purpose**: Pull changes from remote
**Approval**: STANDARD

```typescript
interface GitPullInput {
  remote?: string;        // Remote name (default: origin)
  branch?: string;        // Branch to pull (default: current tracking)
  rebase?: boolean;       // Rebase instead of merge
}
```

**Features**:
- Shows incoming commits preview
- Warns about uncommitted changes
- Clear conflict reporting if pull fails

**Formatter**:
```
⚒ git_pull
  Remote: origin/main
  Strategy: merge
  Incoming: 2 commits
```

---

### 8. `git_branch`

**Purpose**: Branch management (list, create, switch, delete)
**Approval**: Varies by action

```typescript
interface GitBranchInput {
  // List branches (default action if no other specified)
  list?: boolean;
  all?: boolean;          // Include remote branches

  // Create and switch to new branch
  create?: string;        // Branch name to create
  from?: string;          // Base branch/commit (default: HEAD)

  // Switch to existing branch
  switch?: string;        // Branch name to switch to

  // Delete branch
  delete?: string;        // Branch name to delete
  force?: boolean;        // Force delete unmerged branch (-D)
}
```

**Approval by action**:
- `list`: AUTO
- `create`: STANDARD
- `switch`: STANDARD
- `delete`: STANDARD (ALWAYS_APPROVE if `force: true`)

**Formatter (list)**:
```
⚒ git_branch
  Action: list
  Current: feature/git-tools
  Local: 4 branches
  Remote: 6 branches
```

**Formatter (create)**:
```
⚒ git_branch
  Action: create
  Name: feature/new-feature
  From: main (abc1234)
```

**Formatter (delete with force)**:
```
⚒ git_branch
  Action: delete
  ⚠️  FORCE DELETE - Branch has unmerged commits!
  Branch: feature/abandoned
  Unmerged: 3 commits will be lost
```

---

### 9. `git_stash`

**Purpose**: Stash management
**Approval**: Varies by action

```typescript
interface GitStashInput {
  // Push to stash (default if no action specified and changes exist)
  push?: {
    message?: string;
    includeUntracked?: boolean;
  };

  // Pop from stash
  pop?: {
    index?: number;       // Stash index (default: 0)
  };

  // Apply without removing
  apply?: {
    index?: number;
  };

  // List stashes
  list?: boolean;

  // Drop stash
  drop?: {
    index?: number;
  };

  // Clear all stashes
  clear?: boolean;
}
```

**Approval by action**:
- `list`: AUTO
- `push`, `pop`, `apply`: STANDARD
- `drop`: ALWAYS_APPROVE
- `clear`: ALWAYS_APPROVE

**Formatter (push)**:
```
⚒ git_stash
  Action: push
  Message: "WIP: git tools refactor"
  Files: 5 modified, 2 untracked
```

**Formatter (clear)**:
```
⚒ git_stash
  Action: clear
  ⚠️  This will permanently delete all 4 stashes!
```

---

### 10. `git_reset`

**Purpose**: Reset/undo operations
**Approval**: Varies by mode

```typescript
interface GitResetInput {
  // Reset mode
  mode: 'soft' | 'mixed' | 'hard';

  // Target (default: HEAD)
  target?: string;        // Commit/ref to reset to (e.g., "HEAD~1", "abc1234", "main")

  // Reset specific file (ignores mode, uses mixed behavior)
  file?: string;
}
```

**Approval by mode**:
- `soft`: STANDARD - Only moves HEAD, keeps changes staged
- `mixed`: STANDARD - Moves HEAD, unstages changes, keeps working tree
- `hard`: ALWAYS_APPROVE - Discards all changes permanently

**Formatter (soft/mixed)**:
```
⚒ git_reset
  Mode: mixed
  Target: HEAD~1
  Effect: Unstage last commit, keep changes in working tree
  Commits affected: 1
```

**Formatter (hard)**:
```
⚒ git_reset
  Mode: hard
  ⚠️  WARNING: This will permanently discard:
    - 2 commits
    - 5 modified files
    - 45 insertions, 12 deletions
  Target: main
```

---

### 11. `git_pr`

**Purpose**: Pull request management (create, view, list)
**Approval**: Varies by action
**Requires**: `gh` CLI installed

```typescript
interface GitPrInput {
  // Create PR
  create?: {
    title: string;
    body?: string;
    base?: string;        // Target branch (default: default branch)
    draft?: boolean;
  };

  // View PR details
  view?: number;          // PR number

  // List PRs
  list?: {
    state?: 'open' | 'closed' | 'merged' | 'all';
    author?: string;      // Filter by author (use "@me" for self)
    limit?: number;       // Max results (default: 10)
  };
}
```

**Approval by action**:
- `create`: ALWAYS_APPROVE - User should see title/body
- `view`: AUTO
- `list`: AUTO

**Conditional registration**: Only register if `gh` CLI is available:
```typescript
function isGhAvailable(): boolean {
  try {
    execSync('gh --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
```

**Formatter (create)**:
```
⚒ git_pr
  Action: create
  Title: "feat(git): add new git tools"
  Base: main ← feature/git-tools
  Commits: 5
  Draft: no

  Body:
  ────────────────────────────
  Replaces the existing git tools with a new set of 11 focused tools.

  ## Changes
  - Removed git_smart_commit, git_create_pr, git_branch_suggest, git_status_enhanced
  - Added git_status, git_diff, git_log, git_add, git_commit, git_push, git_pull...
  ────────────────────────────
```

**Formatter (list)**:
```
⚒ git_pr
  Action: list
  Filter: open PRs by @me
  Found: 3 PRs
```

---

## Approval Summary

### ALWAYS_APPROVE (Even in auto-accept)

| Tool | Condition | Reason |
|------|-----------|--------|
| `git_commit` | Always | User should see commit message |
| `git_push` | Always | User should see what's being pushed |
| `git_reset` | `mode: 'hard'` | Permanently discards work |
| `git_branch` | `delete` + `force: true` | Loses unmerged commits |
| `git_stash` | `drop` or `clear` | Permanently loses stashed work |
| `git_pr` | `create` | User should see PR title/body |

### STANDARD (Normal mode only)

| Tool | Condition |
|------|-----------|
| `git_add` | Always |
| `git_pull` | Always |
| `git_branch` | `create`, `switch`, `delete` (without force) |
| `git_stash` | `push`, `pop`, `apply` |
| `git_reset` | `mode: 'soft'` or `'mixed'` |

### AUTO (Never requires approval)

| Tool | Condition |
|------|-----------|
| `git_status` | Always |
| `git_diff` | Always |
| `git_log` | Always |
| `git_branch` | `list` |
| `git_stash` | `list` |
| `git_pr` | `view`, `list` |

---

## File Structure

```
source/tools/git/
├── index.ts              # Exports all git tools + conditional registration
├── utils.ts              # Shared git utilities (execGit, isGitRepository, etc.)
├── git-status.tsx        # git_status tool
├── git-diff.tsx          # git_diff tool
├── git-log.tsx           # git_log tool
├── git-add.tsx           # git_add tool
├── git-commit.tsx        # git_commit tool
├── git-push.tsx          # git_push tool
├── git-pull.tsx          # git_pull tool
├── git-branch.tsx        # git_branch tool
├── git-stash.tsx         # git_stash tool
├── git-reset.tsx         # git_reset tool
├── git-pr.tsx            # git_pr tool
└── components/           # Shared formatter components
    ├── GitFileList.tsx
    ├── GitCommitList.tsx
    └── GitWarning.tsx
```

---

## Utilities to Keep/Add (`utils.ts`)

**Keep from current**:
- `execGit(args: string[]): Promise<string>`
- `isGitRepository(): Promise<boolean>`
- `getCurrentBranch(): Promise<string>`
- `getDefaultBranch(): Promise<string>`
- `parseGitStatus(output: string)`

**Add**:
- `isGitAvailable(): boolean` - Sync check for conditional registration
- `isGhAvailable(): boolean` - Check for gh CLI
- `hasUncommittedChanges(): Promise<boolean>`
- `getAheadBehind(): Promise<{ahead: number; behind: number}>`
- `getUnpushedCommits(): Promise<Commit[]>`
- `isRebaseInProgress(): Promise<boolean>`
- `isMergeInProgress(): Promise<boolean>`
- `hasConflicts(): Promise<boolean>`

---

## Implementation Order

1. **Infrastructure**: Update `utils.ts`, add conditional registration
2. **Read-only tools**: `git_status`, `git_diff`, `git_log` (safest to test)
3. **Core write tools**: `git_add`, `git_commit`, `git_push`, `git_pull`
4. **Management tools**: `git_branch`, `git_stash`, `git_reset`
5. **PR tool**: `git_pr` (depends on gh CLI)
6. **Cleanup**: Delete old tools, update tests

---

## Migration

1. Delete old tool files:
   - `git-smart-commit.tsx`
   - `git-create-pr.tsx`
   - `git-branch-suggest.tsx`
   - `git-status-enhanced.tsx`

2. Update `source/tools/git/index.ts` exports

3. Update `source/tools/index.ts` to use conditional registration

4. Update any tests in `git-tools.spec.tsx`
