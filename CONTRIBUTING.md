# Contributing to Nanocoder

Thank you for your interest in contributing to Nanocoder! We welcome contributions from developers of all skill levels. This guide will help you get started with contributing to the project.

## Table of Contents

- [Getting Started](#getting-started)
- [How to Contribute](#how-to-contribute)
- [Development Setup](#development-setup)
- [Testing](#testing)
- [Coding Standards](#coding-standards)
- [Community and Communication](#community-and-communication)

## Getting Started

Before contributing, please:

1. Read our [README](README.md) to understand what Nanocoder does
2. Check our [issue tracker](https://github.com/Nano-Collective/nanocoder/issues) for existing issues

## How to Contribute

### Finding Work

Browse our open issues. If you find an unassigned issue you'd like to work on, comment on it to let us know you're picking it up.

### Working on an Issue

1. **Check for a spec** - Some issues include a specification or implementation details. Feel free to follow it or propose alternatives if you think you have a better approach.

2. **No spec? Write one** - If the issue lacks a spec, draft one and post it in the issue comments for discussion before starting work.

3. **Submit a PR** - When ready, open a pull request referencing the issue. We'll review it and work with you to get it merged.

## Development Setup

### Prerequisites

- Node.js 20+
- npm or pnpm
- Git

### Setup Steps

1. **Fork and clone the repository:**

   ```bash
   git clone https://github.com/YOUR-USERNAME/nanocoder.git
   cd nanocoder
   ```

2. **Install dependencies:**

   ```bash
   pnpm install
   ```

3. **Build the project:**

   ```bash
   pnpm run build
   ```

4. **Test your setup:**

   ```bash
   pnpm run start
   ```

### Using Dev Containers (Recommended)

For a zero-setup, consistent development environment, we recommend using VS Code Dev Containers. This approach eliminates the need to install Node.js, pnpm, or other tools on your local machine.

#### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- [Visual Studio Code](https://code.visualstudio.com/) with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

#### Quick Start

1. **Clone the repository** (if not already done)
   ```bash
   git clone https://github.com/YOUR-USERNAME/nanocoder.git
   cd nanocoder
   ```

2. **Open in VS Code**
   ```bash
   code .
   ```

3. **Reopen in Container**
   - When VS Code prompts "Reopen in Container", click **"Reopen in Container"**
   - Or press `F1` and select `Dev Containers: Reopen in Container`

4. **Wait for Automatic Setup**
   - The container builds on first use (~2-3 minutes)
   - Dependencies install automatically
   - The project builds automatically
   - Git hooks are configured automatically

5. **Start Development**
   ```bash
   pnpm run dev  # Development mode with hot reload
   pnpm test:all # Run all tests
   pnpm run start # Start the application
   ```

#### What's Included

The devcontainer comes pre-configured with:

- **Node.js 20.x** - Pre-installed and ready
- **pnpm 9.x** - Package manager with cached store
- **Biome** - Formatter and linter (auto-formats on save)
- **Zsh + Oh My Zsh** - Enhanced shell experience
- **VS Code Extensions** - Biome, TypeScript, GitLens pre-installed
- **Git Hooks** - Husky pre-commit hooks configured automatically
- **Network Access** - Full connectivity for MCP server testing

#### Benefits

- **Zero Setup** - All tools pre-installed in container
- **Consistent Environment** - Same tools and versions for all developers
- **Isolated Development** - No conflicts with local tools
- **Fast Setup** - Automated dependency installation
- **Easy Cleanup** - Delete container to remove everything

#### For More Information

See [`.devcontainer/README.md`](.devcontainer/README.md) for:
- Troubleshooting steps
- Advanced configuration options
- Git credential setup
- Performance optimization tips

### Recommended Editor Setup

For the best development experience, we recommend using VS Code with the **Biome extension** for automatic formatting and linting:

1. **Install Biome VS Code Extension:**
   - Open VS Code and go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
   - Search for "Biome" and install the official extension: [biomejs.dev/reference/vscode](https://biomejs.dev/reference/vscode/)
   - Or install from the command line:
   ```bash
   code --install-extension biomejs.biome
   ```

2. **Configure VS Code settings** (optional, for format on save):
   Add to your `.vscode/settings.json`:
   ```json
   {
     "editor.defaultFormatter": "biomejs.biome",
     "editor.formatOnSave": true,
     "editor.codeActionsOnSave": {
       "quickfix.biome": "explicit",
       "source.organizeImports.biome": "explicit"
     }
   }
   ```

### Migrating from Prettier

If you previously had Prettier configured in your development environment:

1. **Uninstall/disable the Prettier VS Code extension** to avoid conflicts
2. **Remove any local Prettier configuration** files (`.prettierrc`, `.prettierrc.json`, etc.)
3. **Install the Biome extension** (see instructions above)
4. **Run `pnpm format`** to reformat your working changes with Biome

### Pre-commit Hooks

This project uses **husky** and **lint-staged** to automatically format staged files before each commit. After running `pnpm install`, the pre-commit hook will be set up automatically.

**What happens on commit:**
- Staged `.js`, `.ts`, `.jsx`, `.tsx`, `.json`, and `.md` files are automatically formatted with Biome
- If formatting fails, the commit will be blocked until issues are resolved

**To skip the pre-commit hook** (not recommended):
```bash
git commit --no-verify -m "your message"
```

## Testing

### Automated Testing Requirements

All new features and bug fixes should include appropriate tests:

1. **Test Suite**: We use AVA for testing with TypeScript support
2. **Test Files**: Place test files alongside source code with `.spec.ts` extension (e.g., `source/utils/parser.spec.ts`)
3. **Running Tests**: Execute the full test suite with:

   ```bash
   pnpm test:all
   ```

   This command runs: Biome formatting checks, type checks, lint checks, AVA tests, Knip, security scans.

4. **Test Requirements for PRs**:
   - New features **must** include passing tests in `.spec.ts/tsx` files
   - Bug fixes should include regression tests when possible
   - All tests must pass before merging (`pnpm test:all` should complete successfully)
   - Tests should cover both success cases and error scenarios

### Manual Testing

In addition to automated tests, manual testing is important for CLI interactions:

1. **Test different AI providers:**

   - Ollama (local)
   - OpenRouter (API)
   - OpenAI-compatible endpoints

2. **Test core functionality:**

   - File operations (read, write, edit)
   - Bash command execution
   - Custom commands
   - MCP server integration

3. **Test error scenarios:**
   - Network failures
   - Invalid configurations
   - Missing dependencies

### Writing Tests

When adding tests:

- Use descriptive test names that explain what is being tested
- Follow the existing test patterns in the codebase
- Test edge cases and error conditions
- Keep tests focused and isolated
- Mock external dependencies (APIs, file system) when appropriate

**Test File Organization**:

For simple cases, place test files alongside the source code:

```
source/utils/parser.ts
source/utils/parser.spec.ts
```

For complex testing scenarios requiring multiple test files or shared test utilities, use a `__tests__` directory:

```
source/hooks/useInputState.ts
source/hooks/__tests__/
  ├── test-helpers.ts
  ├── useInputState.deletion.spec.ts
  ├── useInputState.state-management.spec.ts
  └── useInputState.undo-redo.spec.ts
```

This pattern is useful when:

- A single module requires multiple test files organized by category or feature
- Tests need shared fixtures, mocks, or helper functions
- Test complexity benefits from separation of concerns

See `source/hooks/__tests__/` for examples of this pattern in practice.

## Coding Standards

### TypeScript Guidelines

- **Strict Mode**: The project uses strict TypeScript settings
- **Types First**: Always define proper TypeScript types
- **No `any`**: Avoid using `any` type; use proper type definitions
- **ESNext**: Use modern JavaScript/TypeScript features

### Code Style

- **Formatting**: Code is auto-formatted (maintain existing style)
- **Naming**: Use descriptive variable and function names
- **Comments**: Add comments for complex logic, not obvious code
- **Error Handling**: Always handle errors gracefully

### Logging

Nanocoder uses structured logging based on Pino. See [`docs/pino-logging.md`](docs/pino-logging.md) for details.

## Development Tips

### Working with AI Providers

- Test with multiple providers to ensure compatibility
- Handle API failures gracefully
- Respect rate limits and API quotas

### Tool Development

- New tools should implement the common tool interface
- Always validate inputs and handle errors
- Document tool capabilities clearly

### MCP Integration

- Follow MCP protocol specifications
- Test with real MCP servers
- Handle connection failures properly

### UI/UX Considerations

- Maintain consistent CLI interface
- Provide clear feedback to users
- Handle long-running operations gracefully

## Community and Communication

### Getting Help

- **GitHub Issues**: For bugs, features, and questions
- **Discord Server**: Join our community Discord server for real-time discussions, help, and collaboration: [Join our Discord server](https://discord.gg/ktPDV6rekE)

### Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help create a welcoming environment for all contributors
- Remember that everyone is learning and contributing voluntarily

### Recognition

All contributors are recognized in the project. We appreciate:

- Code contributions
- Bug reports and testing
- Documentation improvements
- Feature suggestions and feedback
- Community support and discussions

---

Thank you for contributing to Nanocoder! Your efforts help make local-first AI coding tools more accessible and powerful for everyone.
