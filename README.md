# Nanocoder

A local-first CLI coding agent that brings the power of agentic coding tools like Claude Code and Gemini CLI to local models or controlled APIs like OpenRouter. Built with privacy and control in mind, Nanocoder supports multiple AI providers with tool support for file operations and command execution.

![Example](./.github/assets/example.gif)

---
![Build Status](https://github.com/Nano-Collective/nanocoder/raw/main/badges/build.svg)
![Coverage](https://github.com/Nano-Collective/nanocoder/raw/main/badges/coverage.svg)
![Version](https://github.com/Nano-Collective/nanocoder/raw/main/badges/npm-version.svg)
![NPM Downloads](https://github.com/Nano-Collective/nanocoder/raw/main/badges/npm-downloads-monthly.svg)
![NPM License](https://github.com/Nano-Collective/nanocoder/raw/main/badges/npm-license.svg)
![Repo Size](https://github.com/Nano-Collective/nanocoder/raw/main/badges/repo-size.svg)
![Stars](https://github.com/Nano-Collective/nanocoder/raw/main/badges/stars.svg)
![Forks](https://github.com/Nano-Collective/nanocoder/raw/main/badges/forks.svg)


## Table of Contents

- [FAQs](#faqs)
- [Installation](#installation)
  - [For Users](#for-users)
  - [For Development](#for-development)
- [Usage](#usage)
  - [Interactive Mode](#interactive-mode)
  - [Non-Interactive Mode](#non-interactive-mode)
- [Configuration](#configuration)
  - [AI Provider Setup](#ai-provider-setup)
  - [MCP (Model Context Protocol) Servers](#mcp-model-context-protocol-servers)
  - [User Preferences](#user-preferences)
  - [Application Data Directory](#application-data-directory)
  - [Commands](#commands)
    - [Built-in Commands](#built-in-commands)
    - [Custom Commands](#custom-commands)
- [Features](#features)
  - [Multi-Provider Support](#multi-provider-support)
  - [Advanced Tool System](#advanced-tool-system)
  - [Custom Command System](#custom-command-system)
  - [Enhanced User Experience](#enhanced-user-experience)
  - [Keyboard Shortcuts](#keyboard-shortcuts)
  - [Developer Features](#developer-features)
- [VS Code Extension](#vs-code-extension)
- [Community](#community)

## FAQs

### What is Nanocoder?

Nanocoder is a local-first CLI coding agent that brings the power of agentic coding tools like Claude Code and Gemini CLI to local models or controlled APIs like OpenRouter. Built with privacy and control in mind, Nanocoder supports any AI provider that has an OpenAI compatible end-point, tool and non-tool calling models.

### How is this different to OpenCode?

This comes down to philosophy. OpenCode is a great tool, but it's owned and managed by a venture-backed company that restricts community and open-source involvement to the outskirts. With Nanocoder, the focus is on building a true community-led project where anyone can contribute openly and directly. We believe AI is too powerful to be in the hands of big corporations and everyone should have access to it.

We also strongly believe in the "local-first" approach, where your data, models, and processing stay on your machine whenever possible to ensure maximum privacy and user control. Beyond that, we're actively pushing to develop advancements and frameworks for small, local models to be effective at coding locally.

Not everyone will agree with this philosophy, and that's okay. We believe in fostering an inclusive community that's focused on open collaboration and privacy-first AI coding tools.

### I want to be involved, how do I start?

Firstly, we would love for you to be involved. You can get started contributing to Nanocoder in several ways, check out the [Community](#community) section of this README.

## Installation

### For Users

#### NPM

Install globally and use anywhere:

```bash
npm install -g @nanocollective/nanocoder
```

Then run in any directory:

```bash
nanocoder
```

#### Homebrew (macOS/Linux)

First, tap the repository:

```bash
brew tap nano-collective/nanocoder https://github.com/Nano-Collective/nanocoder
```

Then install:

```bash
brew install nanocoder
```

Run in any directory:

```bash
nanocoder
```

To update:

```bash
# Update Homebrew's tap cache first (important!)
brew update

# Then upgrade nanocoder
brew upgrade nanocoder
```

> **Note**: If `brew upgrade nanocoder` shows the old version is already installed, run `brew update` first. Homebrew caches tap formulas locally and only refreshes them during `brew update`. Without updating the tap cache, you'll see the cached (older) version even if a newer formula exists in the repository.

#### Nix Flakes

Run Nanocoder directly using:

```bash
# If you have flakes enabled in your Nix config:
nix run github:Nano-Collective/nanocoder

# If you don't have flakes enabled:
nix run --extra-experimental-features 'nix-command flakes' github:Nano-Collective/nanocoder
```

Or install from `packages` output:

```nix
# flake.nix
{
  inputs = {
    nanocoder = {
      url = "github:Nano-Collective/nanocoder";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };
}

# configuration.nix
{ pkgs, inputs, system, ... }: {
  environment.systemPackages = [
    inputs.nanocoder.packages."${system}".default
  ];
}
```

### For Development

If you want to contribute or modify Nanocoder:

**Prerequisites:**

- Node.js 20+
- pnpm

**Setup:**

1. Clone and install dependencies:

```bash
git clone [repo-url]
cd nanocoder
pnpm install
```

2. Build the project:

```bash
pnpm run build
```

3. Run locally:

```bash
pnpm run start
```

Or build and run in one command:

```bash
pnpm run dev
```

## Usage

### CLI Options

Nanocoder supports standard CLI arguments for quick information and help:

```bash
# Show version information
nanocoder --version
nanocoder -v

# Show help and available options
nanocoder --help
nanocoder -h
```

**CLI Options Reference:**

| Option | Short | Description |
|--------|-------|-------------|
| `--version` | `-v` | Display the installed version number |
| `--help` | `-h` | Show usage information and available options |
| `--vscode` | | Run in VS Code mode (for extension) |
| `--vscode-port` | | Specify VS Code server port |
| `run` | | Run in non-interactive mode |

**Common Use Cases:**

```bash
# Check version in scripts
echo "Nanocoder version: $(nanocoder --version)"

# Get help in CI/CD pipelines
nanocoder --help

# Quick version check
nanocoder -v

# Discover available options
nanocoder -h
```

### Interactive Mode

To start Nanocoder in interactive mode (the default), simply run:

```bash
nanocoder
```

This will open an interactive chat session where you can:

- Chat with the AI about your code
- Use slash commands (e.g., `/help`, `/model`, `/status`)
- Execute bash commands with `!`
- Tag files with `@`
- Review and approve tool executions
- Switch between different models and providers

### Non-Interactive Mode

For automated tasks, scripting, or CI/CD pipelines, use the `run` command:

```bash
nanocoder run "your prompt here"
```

**Examples:**

```bash
# Simple task
nanocoder run "analyze the code in src/app.ts"

# Code generation
nanocoder run "create a new React component for user login"

# Testing
nanocoder run "write unit tests for all functions in utils.js"

# Refactoring
nanocoder run "refactor the database connection to use a connection pool"
```

**Non-interactive mode behavior:**

- Automatically executes the given prompt
- Runs in auto-accept mode (tools execute without confirmation)
- Displays all output and tool execution results
- Exits automatically when the task is complete

**Note:** When using non-interactive mode with VS Code integration, place any flags (like `--vscode` or `--vscode-port`) before the `run` command:

```bash
nanocoder --vscode run "your prompt"
```

## Configuration

### AI Provider Setup

Nanocoder supports any OpenAI-compatible API through a unified provider configuration.

**Configuration Methods:**

1. **Interactive Setup (Recommended for new users)**: Run `/setup-providers` inside Nanocoder for a guided wizard with provider templates. The wizard allows you to:
   - Choose between project-level or global configuration
   - Select from common provider templates (Ollama, OpenRouter, LM Studio, etc.)
   - Add custom OpenAI-compatible providers manually
   - Edit or delete existing providers
   - Fetch available models automatically from your provider
2. **Manual Configuration**: Create an `agents.config.json` file (see below for locations)

> **Note**: The `/setup-providers` wizard requires at least one provider to be configured before saving. You cannot exit without adding a provider.

**Configuration File Locations:**

Nanocoder looks for configuration in the following order (first found wins):

1. **Project-level** (highest priority): `agents.config.json` in your current working directory

   - Use this for project-specific providers, models, or API keys
   - Perfect for team sharing or repository-specific configurations

2. **User-level (preferred)**: Platform-specific configuration directory

   - **macOS**: `~/Library/Preferences/nanocoder/agents.config.json`
   - **Linux/Unix**: `~/.config/nanocoder/agents.config.json`
   - **Windows**: `%APPDATA%\nanocoder\agents.config.json`
   - Your global default configuration
   - Used when no project-level config exists

   You can override this global configuration directory by setting `NANOCODER_CONFIG_DIR`. When set, Nanocoder will look for `agents.config.json` and related config files directly in this directory.

3. **User-level (legacy)**: `~/.agents.config.json`
   - Supported for backward compatibility
   - Recommended to migrate to platform-specific location above

**Example Configuration** (`agents.config.json`):

```json
{
	"nanocoder": {
		"providers": [
			{
				"name": "llama-cpp",
				"baseUrl": "http://localhost:8080/v1",
				"models": ["qwen3-coder:a3b", "deepseek-v3.1"]
			},
			{
				"name": "Ollama",
				"baseUrl": "http://localhost:11434/v1",
				"models": ["qwen2.5-coder:14b", "llama3.2"]
			},
			{
				"name": "OpenRouter",
				"baseUrl": "https://openrouter.ai/api/v1",
				"apiKey": "your-openrouter-api-key",
				"models": ["openai/gpt-4o-mini", "anthropic/claude-3-haiku"]
			},
			{
				"name": "LM Studio",
				"baseUrl": "http://localhost:1234/v1",
				"models": ["local-model"]
			},
			{
				"name": "Z.ai",
				"baseUrl": "https://api.z.ai/api/paas/v4/",
				"apiKey": "your-z.ai-api-key",
				"models": ["glm-4.7", "glm-4.5", "glm-4.5-air"]
			},
			{
				"name": "Z.ai Coding Subscription",
				"baseUrl": "https://api.z.ai/api/coding/paas/v4/",
				"apiKey": "your-z.ai-coding-api-key",
				"models": ["glm-4.7", "glm-4.5", "glm-4.5-air"]
			},
			{
				"name": "GitHub Models",
				"baseUrl": "https://models.github.ai/inference",
				"apiKey": "your-github-pat",
				"models": ["openai/gpt-4o-mini", "meta/llama-3.1-70b-instruct"]
			},
			{
				"name": "Poe",
				"baseUrl": "https://api.poe.com/v1",
				"apiKey": "your-poe-api-key",
				"models": ["Claude-Sonnet-4", "GPT-4o", "Gemini-2.5-Pro"]
			}
		]
	}
}
```

**Common Provider Examples:**

- **llama.cpp server**: `"baseUrl": "http://localhost:8080/v1"`
- **llama-swap**: `"baseUrl": "http://localhost:9292/v1"`
- **Ollama (Local)**: `"baseUrl": "http://localhost:11434/v1"`
- **OpenRouter (Cloud)**: `"baseUrl": "https://openrouter.ai/api/v1"`
- **LM Studio**: `"baseUrl": "http://localhost:1234/v1"`
- **vLLM**: `"baseUrl": "http://localhost:8000/v1"`
- **LocalAI**: `"baseUrl": "http://localhost:8080/v1"`
- **OpenAI**: `"baseUrl": "https://api.openai.com/v1"`
- **Poe**: `"baseUrl": "https://api.poe.com/v1"` (get API key from [poe.com/api_key](https://poe.com/api_key))
- **GitHub Models**: `"baseUrl": "https://models.github.ai/inference"` (requires PAT with `models:read` scope)
- **Z.ai**: `"baseUrl": "https://api.z.ai/api/paas/v4/"`
- **Z.ai Coding**: `"baseUrl": "https://api.z.ai/api/coding/paas/v4/"`

**Provider Configuration:**

- `name`: Display name used in `/provider` command
- `baseUrl`: OpenAI-compatible API endpoint
- `apiKey`: API key (optional, may not be required)
- `models`: Available model list for `/model` command
- `disableToolModels`: List of model names to disable tool calling for (optional)

**Environment Variables:**

Keep API keys out of version control using environment variables. Variables are loaded from shell environment (`.bashrc`, `.zshrc`) or `.env` file in your working directory.

- `NANOCODER_CONFIG_DIR`: Override the global configuration directory.
- `NANOCODER_DATA_DIR`: Override the application data directory used for internal data like usage statistics.

**Syntax:** `$VAR_NAME`, `${VAR_NAME}`, or `${VAR_NAME:-default}`
**Supported in:** `baseUrl`, `apiKey`, `models`, `disableToolModels`, `MCP server`, `command`, `args`, `env`

See `.env.example` for setup instructions

**Timeout Configuration:**

Nanocoder allows you to configure timeouts for your AI providers to handle long-running requests.

- `requestTimeout`: (Optional) The application-level timeout in milliseconds. This is the total time the application will wait for a response from the provider. If not set, it defaults to 2 minutes (120,000 ms). Set to `-1` to disable this timeout.
- `socketTimeout`: (Optional) The socket-level timeout in milliseconds. This controls the timeout for the underlying network connection. If not set, it will use the value of `requestTimeout`. Set to `-1` to disable this timeout.

It is recommended to set both `requestTimeout` and `socketTimeout` to the same value for consistent behavior. For very long-running requests, you can disable timeouts by setting both to `-1`.

- `connectionPool`: (Optional) An object to configure the connection pooling behavior for the underlying socket connection.
  - `idleTimeout`: (Optional) The timeout in milliseconds for how long an idle connection should be kept alive in the pool. Defaults to 4 seconds (4,000 ms).
  - `cumulativeMaxIdleTimeout`: (Optional) The maximum time in milliseconds a connection can be idle. Defaults to 10 minutes (600,000 ms).

**Example with Timeouts:**

```json
{
	"nanocoder": {
		"providers": [
			{
				"name": "llama-cpp",
				"baseUrl": "http://localhost:8080/v1",
				"models": ["qwen3-coder:a3b", "deepseek-v3.1"],
				"requestTimeout": -1,
				"socketTimeout": -1,
				"connectionPool": {
					"idleTimeout": 30000,
					"cumulativeMaxIdleTimeout": 3600000
				}
			}
		]
	}
}
```

**Troubleshooting Context Length Issues:**

If you experience the model repeating tool calls or getting into loops (especially with multi-turn conversations), this is often caused by insufficient context length settings in your local AI provider:

- **LM Studio**: Increase "Context Length" in Settings → Model Settings (recommended: 8192 or higher)
- **Ollama**: Set context length with `OLLAMA_NUM_CTX=8192`
- **llama.cpp**: Use `--ctx-size 8192` or higher when starting the server
- **vLLM**: Set `--max-model-len 8192` when launching

Tool-calling conversations require more context to track the history of tool calls and their results. If the context window is too small, the model may lose track of previous actions and repeat them indefinitely.

### Logging Configuration

Nanocoder now includes comprehensive structured logging with Pino, providing enterprise-grade logging capabilities including correlation tracking, performance monitoring, and security features.

**Logging Configuration Options:**

```bash
# Environment Variables
NANOCODER_LOG_LEVEL=debug          # Log level (trace, debug, info, warn, error, fatal)
NANOCODER_LOG_TO_FILE=true         # Enable file logging
NANOCODER_LOG_TO_CONSOLE=true      # Enable console logging
NANOCODER_LOG_DIR=/var/log/nanocoder # Log directory
NANOCODER_CORRELATION_ENABLED=true  # Enable correlation tracking
```

**Features:**
- Structured JSON logging with metadata support
- Correlation tracking across components
- Automatic PII detection and redaction
- Performance monitoring and metrics
- Production-ready file rotation and compression

**Default Log File Locations:**

When `NANOCODER_LOG_TO_FILE=true` is set, logs are stored in platform-specific locations:

- **macOS**: `~/Library/Preferences/nanocoder/logs`
- **Linux/Unix**: `~/.config/nanocoder/logs/nanocoder/`
- **Windows**: `%APPDATA%\nanocoder\logs\`

You can override the default location using `NANOCODER_LOG_DIR` environment variable.

For complete documentation, see [Pino Logging Guide](docs/pino-logging.md).

### MCP (Model Context Protocol) Servers

Nanocoder supports MCP servers to extend its capabilities with additional tools. Configure servers using `.mcp.json` files at project or global level.

**Quick Start:**

1. Run `/setup-mcp` for an interactive wizard with templates
2. Or create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "./src"],
      "alwaysAllow": ["list_directory", "read_file"]
    },
    "github": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "$GITHUB_TOKEN" }
    }
  }
}
```

**Key Features:**

- **Transport types**: `stdio` (local), `http`, `websocket` (remote)
- **Auto-approve tools**: Use `alwaysAllow` to skip confirmation for trusted tools
- **Environment variables**: Use `$VAR` or `${VAR:-default}` syntax
- **Hierarchical config**: Project-level (`.mcp.json`) overrides global (`~/.config/nanocoder/.mcp.json`)

**Commands:**

- `/setup-mcp` - Interactive configuration wizard (supports `Ctrl+E` for manual editing)
- `/mcp` - Show connected servers and their tools

Popular MCP servers: Filesystem, GitHub, Brave Search, Context7, DeepWiki, and [many more](https://github.com/modelcontextprotocol/servers).

> **Full documentation**: See the [MCP Configuration Guide](docs/mcp-configuration.md) for detailed setup, examples, and troubleshooting.

### User Preferences

Nanocoder automatically saves your preferences to remember your choices across sessions.

**Preferences File Locations:**

Preferences follow the same location hierarchy as configuration files:

1. **Project-level**: `nanocoder-preferences.json` in your current working directory (overrides user-level)
2. **User-level**: Platform-specific application data directory:
   - **macOS**: `~/Library/Preferences/nanocoder/nanocoder-preferences.json`
   - **Linux/Unix**: `~/.config/nanocoder/nanocoder-preferences.json`
   - **Windows**: `%APPDATA%\nanocoder\nanocoder-preferences.json`
3. **Legacy**: `~/.nanocoder-preferences.json` (backward compatibility)

**What gets saved automatically:**

- **Last provider used**: The AI provider you last selected (by name from your configuration)
- **Last model per provider**: Your preferred model for each provider
- **Session continuity**: Automatically switches back to your preferred provider/model when restarting
- **Last theme used**: The theme you last selected

**Manual management:**

- View current preferences: The file is human-readable JSON
- Reset preferences: Delete any `nanocoder-preferences.json` to start fresh

### Application Data Directory

Nanocoder stores internal application data (such as usage statistics) in a separate application data directory:

- **macOS**: `~/Library/Application Support/nanocoder`
- **Linux/Unix**: `$XDG_DATA_HOME/nanocoder` or `~/.local/share/nanocoder`
- **Windows**: `%APPDATA%\nanocoder`

You can override this directory using `NANOCODER_DATA_DIR`.

### Commands

#### Built-in Commands

- `/help` - Show available commands
- `/init` - Initialize project with intelligent analysis, create AGENTS.md and configuration files. Use `/init --force` to regenerate AGENTS.md if it already exists.
- `/setup-providers` - Interactive wizard for configuring AI providers with templates
- `/setup-mcp` - Interactive wizard for configuring MCP servers with templates
- `/clear` - Clear chat history
- `/model` - Switch between available models
- `/provider` - Switch between configured AI providers
- `/status` - Display current status (CWD, provider, model, theme, available updates, AGENTS setup)
- `/model-database` - Browse coding models from OpenRouter (searchable, filterable by open/proprietary)
- `/mcp` - Show connected MCP servers and their tools
- `/custom-commands` - List all custom commands
- `/checkpoint` - Save and restore conversation snapshots (see [Checkpointing](#checkpointing) section)
- `/compact` - Compress message history to reduce context usage (see [Context Compression](docs/context-compression.md))
- `/exit` - Exit the application
- `/export` - Export current session to markdown file
- `/theme` - Select a theme for the Nanocoder CLI
- `/title-shape` - Select a title shape style for the Nanocoder CLI (real-time preview)
- `/nanocoder-shape` - Select a branding font style for the Nanocoder welcome banner (real-time preview)
- `/update` - Update Nanocoder to the latest version
- `/usage` – Get current model context usage visually
- `/lsp` – List connected LSP servers
- `!command` - Execute bash commands directly without leaving Nanocoder (output becomes context for the LLM)
- `@file` - Include file contents in messages automatically via fuzzy search as you type

#### Checkpointing

Nanocoder supports conversation checkpointing, allowing you to save snapshots of your coding sessions and restore them later. This is perfect for experimenting with different approaches or preserving important milestones.

**Checkpoint Commands:**

- `/checkpoint create [name]` - Create a checkpoint with optional custom name

  - Auto-generates timestamp-based name if not provided
  - Captures conversation history, modified files, and AI model configuration
  - Example: `/checkpoint create feature-auth-v1`

- `/checkpoint list` - List all available checkpoints

  - Shows checkpoint name, creation time, message count, and files changed
  - Sorted by creation date (newest first)

- `/checkpoint load [name]` - Restore files from a checkpoint

  - **Without name**: Shows interactive list to select checkpoint
  - **With name**: Directly loads the specified checkpoint
  - Prompts "Create backup before loading? (Y/n)" if current session has messages
  - Press Y (or Enter) to auto-backup, N to skip, Esc to cancel
  - Note: Conversation history restore requires restarting Nanocoder
  - Example: `/checkpoint load` (interactive) or `/checkpoint load feature-auth-v1`

- `/checkpoint delete <name>` - Delete a checkpoint permanently
  - Removes checkpoint and all associated data
  - Example: `/checkpoint delete old-checkpoint`

**What gets saved:**

- Complete conversation history
- Modified files with their content (detected via git)
- Active provider and model configuration
- Timestamp and metadata

**Storage location:**

- Checkpoints are stored in `.nanocoder/checkpoints/` in your project directory
- Each project has its own checkpoints
- Consider adding `.nanocoder/checkpoints` to your `.gitignore`

**Example workflow:**

```bash
# Create a checkpoint before trying a new approach
/checkpoint create before-refactor

# Make some experimental changes...
# If things go wrong, restore the checkpoint
/checkpoint load before-refactor

# Or if things went well, create a new checkpoint
/checkpoint create after-refactor

# List all checkpoints to see your progress
/checkpoint list
```

#### Custom Commands

Nanocoder supports custom commands defined as markdown files in the `.nanocoder/commands` directory. Like `agents.config.json`, this directory is created per codebase, allowing you to create reusable prompts with parameters and organize them by category specific to each project.

**Example custom command** (`.nanocoder/commands/test.md`):

```markdown
---
description: 'Generate comprehensive unit tests for the specified component'
aliases: ['testing', 'spec']
parameters:
  - name: 'component'
    description: 'The component or function to test'
    required: true
---

Generate comprehensive unit tests for {{component}}. Include:

- Happy path scenarios
- Edge cases and error handling
- Mock dependencies where appropriate
- Clear test descriptions
```

**Usage**: `/test component="UserService"`

**Features**:

- YAML frontmatter for metadata (description, aliases, parameters)
- Template variable substitution with `{{parameter}}` syntax
- Namespace support through directories (e.g., `/refactor:dry`)
- Autocomplete integration for command discovery
- Parameter validation and prompting

**Pre-installed Commands**:

- `/test` - Generate comprehensive unit tests for components
- `/review` - Perform thorough code reviews with suggestions
- `/refactor:dry` - Apply DRY (Don't Repeat Yourself) principle
- `/refactor:solid` - Apply SOLID design principles

## Features

### Multi-Provider Support

- **Universal OpenAI compatibility**: Works with any OpenAI-compatible API
- **Local providers**: Ollama, LM Studio, vLLM, LocalAI, llama.cpp
- **Cloud providers**: OpenRouter, OpenAI, and other hosted services
- **Smart fallback**: Automatically switches to available providers if one fails
- **Per-provider preferences**: Remembers your preferred model for each provider
- **Dynamic configuration**: Add any provider with just a name and endpoint

### Advanced Tool System

- **Built-in tools**: File operations, bash command execution
- **MCP (Model Context Protocol) servers**: Extend capabilities with any MCP-compatible tool
- **Dynamic tool loading**: Tools are loaded on-demand from configured MCP servers
- **Tool approval**: Optional confirmation before executing potentially destructive operations

### Custom Command System

- **Markdown-based commands**: Define reusable prompts in `.nanocoder/commands/`
- **Template variables**: Use `{{parameter}}` syntax for dynamic content
- **Namespace organization**: Organize commands in folders (e.g., `refactor/dry.md`)
- **Autocomplete support**: Tab completion for command discovery
- **Rich metadata**: YAML frontmatter for descriptions, aliases, and parameters

### Enhanced User Experience

- **Smart autocomplete**: Tab completion for commands with real-time suggestions
- **Colorized output**: Syntax highlighting and structured display
- **Session persistence**: Maintains context and preferences across sessions
- **Real-time streaming**: Live token-by-token streaming of AI responses
- **Real-time indicators**: Shows token usage, timing, and processing status
- **First-time directory security disclaimer**: Prompts on first run and stores a per-project trust decision to prevent accidental exposure of local code or secrets.
- **Development modes**: Three modes to control tool execution behavior (toggle with Shift+Tab)
  - **Normal mode**: Standard tool confirmation flow - review potentially dangerous tool calls before execution
  - **Auto-accept mode**: Automatically accepts more tool calls without confirmation for faster workflows
  - **Plan mode**: AI suggests actions but doesn't execute tools - useful for planning and exploration

### Keyboard Shortcuts

| Action | Shortcut | Notes |
|--------|----------|-------|
| Submit prompt | Enter | |
| New line (multi-line input) | Ctrl+J | Most reliable across terminals |
| New line (multi-line input) | Shift+Enter | Terminal-dependent |
| New line (multi-line input) | Option/Alt+Enter | VS Code integrated terminal |
| Toggle development mode | Shift+Tab | Cycles through normal/auto-accept/plan |
| Cancel AI response | Esc | While AI is processing |
| Clear input | Esc (twice) | Press Esc twice to clear current input |
| History navigation | ↑/↓ | Navigate through prompt history |

> **Note on multi-line input**: Terminal support for Shift+Enter / Option/Alt+Enter varies in terminals and operating systems. If one of these shortcuts doesn't work in your terminal, try and use Ctrl+J which sends a literal newline character and works more reliably across platforms and software.

### Developer Features

- **TypeScript-first**: Full type safety and IntelliSense support
- **Extensible architecture**: Plugin-style system for adding new capabilities
- **Project-specific config**: Different settings per project via `agents.config.json`
- **Error resilience**: Graceful handling of provider failures and network issues

## VS Code Extension

Nanocoder includes a VS Code extension that provides live diff previews of file changes directly in your editor. When the AI suggests file modifications, you can see exactly what will change before approving.

To get started, run Nanocoder with the `--vscode` flag:

```bash
nanocoder --vscode
```

For full documentation including installation options, configuration, and troubleshooting, see the [VS Code Extension Guide](docs/vscode-extension.md).

## Community

We're a small community-led team building Nanocoder and would love your help! Whether you're interested in contributing code, documentation, or just being part of our community, there are several ways to get involved.

**If you want to contribute to the code:**

- Read our detailed [CONTRIBUTING.md](CONTRIBUTING.md) guide for information on development setup, coding standards, and how to submit your changes.

**If you want to be part of our community or help with other aspects like design or marketing:**

- Join our Discord server to connect with other users, ask questions, share ideas, and get help: [Join our Discord server](https://discord.gg/ktPDV6rekE)

- Head to our GitHub issues or discussions to open and join current conversations with others in the community.

**What does Nanocoder need help with?**

Nanocoder could benefit from help all across the board. Such as:

- Adding support for new AI providers
- Improving tool functionality
- Enhancing the user experience
- Writing documentation
- Reporting bugs or suggesting features
- Marketing and getting the word out
- Design and building more great software

All contributions and community participation are welcome!