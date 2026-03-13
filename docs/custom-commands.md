# Custom Commands

Custom commands let you define reusable AI prompts as markdown files. Each command becomes a slash command you can invoke during a session, with support for parameters, aliases, auto-injection, and namespace organization.

## Quick Start

```bash
# Create a command with AI assistance
/commands create review-code

# Or create the file manually
mkdir -p .nanocoder/commands
```

`.nanocoder/commands/review-code.md`:

```markdown
---
description: Review code for issues and improvements
aliases: [review]
parameters: [filename]
---

Review {{filename}} for:
- Bugs and edge cases
- Performance issues
- Code style and readability
```

Then invoke it:

```bash
/review-code src/app.ts
```

## File Structure

Commands live in `.nanocoder/commands/` in your project root. Each `.md` file becomes a command named after the file.

```
.nanocoder/commands/
  test.md              -> /test
  review.md            -> /review
  refactor/
    dry.md             -> /refactor:dry
    solid.md           -> /refactor:solid
```

Subdirectories create namespaced commands using colon syntax (e.g., `refactor/dry.md` becomes `/refactor:dry`).

## Frontmatter Reference

All fields are optional except that every command should have a `description`. Frontmatter uses standard YAML between `---` delimiters.

```yaml
---
description: What this command does
aliases: [alt-name, shortcut]
parameters: [filename, target]
tags: [testing, quality]
triggers: [write tests, unit test]
estimated-tokens: 2000
resources: true
category: testing
version: 1.0.0
author: your-name
examples:
  - /my-command src/utils.ts
  - /my-command lib/parser.ts
references: [docs/guide.md]
dependencies: [other-command]
---
```

### Field Details

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | Shown in `/commands` list and `/commands show` |
| `aliases` | string[] | Alternative names to invoke the command |
| `parameters` | string[] | Named placeholders, usable as `{{param}}` in the body |
| `tags` | string[] | Keywords for auto-injection when the user's message matches |
| `triggers` | string[] | Phrases that auto-inject this command into context |
| `estimated-tokens` | number | Token budget hint, shown in `/commands` list for auto-injectable commands |
| `resources` | boolean | If `true`, loads sibling files in the same directory as extra context |
| `category` | string | Organizational grouping, shown in `/commands show` |
| `version` | string | Version string, shown in `/commands show` |
| `author` | string | Author name, shown in `/commands show` |
| `examples` | string[] | Usage examples, shown in `/commands show` |
| `references` | string[] | Related files or URLs, shown in `/commands show` |
| `dependencies` | string[] | Other commands this one depends on |

### Array Syntax

Arrays can be written in either JSON-style or YAML dash syntax:

```yaml
# JSON-style (inline)
aliases: [review, code-review]

# YAML dash syntax (multiline)
aliases:
  - review
  - code-review
```

## Parameters

Parameters defined in frontmatter become `{{param}}` placeholders in the command body. When the user invokes the command, positional arguments fill in the placeholders.

```yaml
---
parameters: [filename, style]
---

Review {{filename}} using {{style}} conventions.
```

```bash
/review src/app.ts airbnb
# Becomes: Review src/app.ts using airbnb conventions.
```

Built-in variables are always available:

- `{{cwd}}` - Current working directory
- `{{command}}` - The command name
- `{{args}}` - All arguments as a single string

## Auto-Injection

Commands with `tags` or `triggers` can be automatically injected into the system prompt when the user's message matches. This lets you add context-specific instructions without the user needing to invoke the command explicitly.

- **tags**: Matched as keywords against the user's message
- **triggers**: Matched as phrases against the user's message

```yaml
---
description: Testing conventions for this project
tags: [testing, test, spec]
triggers: [write tests, add tests]
estimated-tokens: 1500
---

When writing tests for this project, follow these conventions:
- Use AVA as the test framework
- Place spec files alongside source files
- ...
```

## Resources

When `resources: true` is set, all sibling files in the same directory as the command are loaded and passed as additional context. This is useful for directory-as-command patterns where you bundle templates, configs, or reference documents alongside the command.

```
.nanocoder/commands/
  api-gen/
    api-gen.md        -> The command (must match directory name)
    template.yaml     -> Loaded as a resource
    examples.json     -> Loaded as a resource
```

## Commands

| Command | Description |
|---------|-------------|
| `/commands` | List all custom commands |
| `/commands show <name>` | Show detailed info about a command |
| `/commands refresh` | Reload commands from disk |
| `/commands create <name>` | Create a new command file with AI assistance |

### `/commands create`

Creates a new command file in `.nanocoder/commands/` and starts an AI-assisted session to write its content. The AI will ask what you want the command to do, then write the markdown file for you.

```bash
/commands create lint-fix
```

The `.md` extension is added automatically.

## Examples

### Test Generator

```markdown
---
description: Generate comprehensive unit tests
aliases: [unittest, test-gen]
parameters: [filename]
---

Generate comprehensive unit tests for the file {{filename}}.

Consider the following:

1. Test all public functions and methods
2. Include edge cases and error scenarios
3. Use appropriate mocking where needed
4. Follow the existing test framework conventions in this project
5. Ensure good test coverage

If {{filename}} is not provided, analyze the most recently modified files and suggest which ones need tests.
```

### DRY Refactoring

```markdown
---
description: Apply DRY principle to reduce code duplication
aliases: [dedupe]
parameters: [target]
---

Analyze {{target}} for code duplication and apply the DRY (Don't Repeat Yourself) principle.

Steps:

1. Identify repeated code patterns
2. Extract common functionality into reusable functions/components
3. Update all instances to use the new abstraction
4. Ensure no functionality is broken
5. Run tests if available
```

### Git Issue Checker

```markdown
---
description: Fetch and list open GitHub issues
aliases: [issues, open-issues]
category: git
---

List all open GitHub issues for this repository. Show the issue number, title, labels, and assignee for each.
```

## Tips

- **Start with `/commands create`**: Let the AI help you write your first commands
- **Keep prompts focused**: Commands work best with clear, specific instructions
- **Use parameters for flexibility**: Instead of hardcoding paths, use `{{filename}}` or `{{target}}`
- **Organize with directories**: Group related commands under a namespace (e.g., `refactor/`)
- **Use aliases for convenience**: Add short aliases for commands you use frequently
