# 1.22.4

- Security: Tool validators now run inside the AI SDK's auto-execution loop. Previously, tools with `needsApproval: false` (like `read_file`) were auto-executed by the AI SDK's `generateText` without any path validation, allowing the model to read or write files outside the project directory using absolute or `~` paths. Validators are now wrapped into each tool's `execute` function at registration time, ensuring validation runs in all code paths.

- Security: Reject home directory shorthand (`~`) in file path validation. Paths starting with `~` are not expanded by Node.js and could bypass project boundary checks.

- Fix: Tab characters in code blocks within assistant messages now render at 2-space width instead of the terminal default of 8 spaces. This prevents long lines from wrapping prematurely and eliminates the blocky visual effect on messages containing indented code.

- Fix: `normalizeIndentation` no longer short-circuits when the minimum indent is 0. Previously, if any line in the context window had zero indentation, raw tab characters passed through to the terminal unchanged, rendering at 8-space width in `string_replace` diff previews.

# 1.22.3

- Fix: Removed tool call deduplication from JSON parser that silently dropped duplicate tool calls, breaking the 1:1 pairing between tool calls and results expected by AI SDK. This caused "Tool result is missing for tool call" errors that would end the agent's turn prematurely. Consolidated three overlapping regex patterns into a single comprehensive pattern to prevent duplicate matches. Thanks to @cleyesode.

- Fix: Added missing capture group for arguments in the consolidated JSON tool call regex pattern, which caused inline tool calls to have empty arguments instead of actual parsed values.

- Fix: When the model batched read-only and write tools in a single response (e.g. `read_file` + `string_replace`), the auto-executed read tools would recurse into the next conversation turn, abandoning the confirmation-needed write tools. This left orphaned `tool_use` blocks without matching `tool_result` entries, triggering intermittent "Tool result is missing for tool call" errors with the Anthropic provider.

- Dependency updates: `@ai-sdk/openai-compatible` 2.0.27, `undici` 7.21.0, `@biomejs/biome` 2.3.14, `@types/vscode` 1.109.0, `@types/node` 25.2.1.

# 1.22.2

- Fix: Markdown tables in assistant messages were rendered at full terminal width instead of accounting for the message box border and padding, causing broken box-drawing characters when lines wrapped.

# 1.22.1

- Added native Anthropic SDK support via `@ai-sdk/anthropic` package. The Anthropic Claude provider template now uses `sdkProvider: 'anthropic'` for direct API integration instead of the OpenAI-compatible wrapper.

- Fixed Kimi Code provider template to use the native `@ai-sdk/anthropic` SDK with correct base URL and configuration passthrough.

- Fix: User message token count now reflects the full assembled content including pasted content and tagged file contents, instead of only counting the placeholder text.

- Fix: Removed aggressive tool call deduplication that silently dropped duplicate tool call IDs and identical function signatures. This could cause "Tool result is missing for tool call" errors with providers like Anthropic that strictly validate tool call/result pairing.

# 1.22.0

- Added `/explorer` command for interactive file browsing with tree view navigation, file preview with syntax highlighting, multi-file selection, search mode, and VS Code integration. Closes #298.

- Added task management tools (`create_task`, `list_tasks`, `update_task`, `delete_task`) with `/tasks` slash command for models to track and manage progress on complex work. Tasks persist in `.nanocoder/tasks.json` and are automatically cleared on CLI boot and `/clear` command.

- Added `/settings` command for interactive command menu to configure UI theme and shapes without editing config files directly.

- Added `sdkProvider` configuration option for native Google Gemini support. This fixes the "missing thought_signature" error with Gemini 3 models by using the `@ai-sdk/google` package. Closes #302.

- Added custom headers support in provider configuration. This enables authentication through tunnels like Cloudflare. Thanks to @nicolalamacchia.

- Added Kimi Code provider template in configuration wizard.

- Added new themes with updated user input and user message styling for better visual clarity and consistency.

- Added token count display after messages and completion message to provide visibility into context usage throughout conversations.

- Refactored git tools for better consistency, improved error handling, standardized parameter handling across all git operations, and enhanced user feedback messages.

- Added line truncation in `write_file` and `string_replace` formatters to prevent excessive output from files with very long lines and neaten user experience on narrow terminals.

- Fix: `/usage` command crash when context data is unavailable.

- Fix: String replace error handling for edge cases.

- Fix: Multiple security audit issues resolved.

- Fix: Various styling improvements across components.

- Fix: Dependency lockfile issues resolved.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.21.0

- Added `/compact` command for context compression with `--restore` flag support to restore messages from backup. The command now includes auto-compact functionality, consistent token counting, and improved compression for very long messages. Thanks to @Pahari47.

- Added hierarchical configuration loading for both provider configs and MCP servers. Local project configurations now properly override global settings, and Claude Code's object-style MCP configuration format is now supported. Thanks to @Avtrkrb.

- Added `alwaysAllow` configuration option for MCP servers to auto-approve trusted tools without confirmation prompts. Thanks to @namar0x0309.

- Added automatic tool support error detection and retry mechanism. Models that don't support function calling are now detected and requests automatically retry without tools. Thanks to @ThomasBrugman.

- Added `--version` and `--help` CLI command options for quick reference. Thanks to @Avtrkrb.

- Added `/quit` command as an alternative way to exit Nanocoder. Thanks to @Avtrkrb.

- Added `/nanocoder-shape` command for selecting branding font styles.

- Added keyboard shortcuts documentation to README.

- Renamed `/setup-config` to `/setup-providers` for clearer naming.

- Improved `/mcp` command modal with better colors and title formatting. Thanks to @Avtrkrb.

- Improved `/help` command title heading styling. Thanks to @Avtrkrb.

- Added CLI test harness for non-interactive mode testing. Thanks to @akramcodez.

- Added comprehensive test suite for tool error detection. Thanks to @ThomasBrugman.

- Added `DisableToolModels` documentation to README. Thanks to @ThomasBrugman.

- Fix: Resolved bash tool keeping processes alive after command completion.

- Fix: Corrected log directory paths and enabled file logging in production.

- Fix: Improved deprecation message for MCP config to display correct config directory instead of hardcoded Linux path. Thanks to @Avtrkrb.

- Fix: Resolved shell command security scanning alerts built from environment values. Thanks to @Avtrkrb.

- Fix: Security audit dependencies updated.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.20.4

- Fixed configuration wizard blocking users from entering HTTP URLs for remote Ollama servers. The wizard now allows any valid HTTP/HTTPS URL without requiring local network addresses.

- Fixed `@modelcontextprotocol/sdk` dependency version to resolve npm audit security issue.

- Fixed TLS certificate errors when using `uvx` MCP servers behind corporate proxies. Nanocoder now automatically adds `--native-tls` to uvx commands to use system certificates instead of rustls.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.20.3

- Fixed `search_file_contents` returning excessive tokens by truncating long matching lines to 300 characters. Previously, searching in files with long lines (minified JS, base64 data, etc.) could return ~100k tokens for just 30 matches.

- Added validation to `read_file` to reject minified/binary files (lines >10,000 characters). These files consume excessive tokens without providing useful information to the model. Use `metadata_only=true` to still check file properties.

- Fixed `web_search` result count display showing mismatched values (e.g., "10 / 5 results"). The formatter now correctly uses the same default as the search execution.

- Improved `web_search` and `fetch_url` formatter layouts to match `execute_bash` style with consistent column alignment and spacing.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.20.2

- Added preview generation to git workflow tools (`git-status-enhanced`, `git-smart-commit`, `git-create-pr`) showing results before execution.

- Fixed `string-replace` line number display in result mode - now correctly shows line numbers of new content after replacement.

- Added hammer icon (⚒) to git tool formatters for visual consistency.

- Improved formatting in `bash-progress`, `execute-bash`, and `read-file` tools with better spacing and layout.

- Simplified `string-replace` validation logic and removed redundant success messages.

- Fix: Running `/init --force` added duplication to `AGENTS.md`.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.20.1

Fix: React Context Error - useTitleShape must be used within a TitleShapeProvider

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.20.0

Happy New Year! We all hope you had a great holidays and are feeling refreshed ready for 2026 🌟

- Added Catpuccin themes (Latte, Frappe, Macchiato, Mocha) with gradient color support. Thanks to @Avtrkrb.

- Added VS Code context menu integration - you can now right-click selected code and ask Nanocoder about it directly.

- Added comprehensive testing achieving 90%+ code coverage across components, hooks, tools, and utilities. Tests now include unit and integration coverage for critical paths.

- Added automated PR checks workflow with format, type, lint, and test validation. Pull requests now get automatic quality checks. Thanks to @Avtrkrb.

- Added LSP support for Deno, GraphQL, Docker/Docker Compose, and Markdown language servers with automatic project detection. Thanks to @yashksaini-coder.

- Added auto-fetch models feature in setup wizard - providers can now automatically fetch available models during configuration. Thanks to @JimStenstrom.

- Added git workflow integration tools including smart commit message generation, PR template creation, branch naming suggestions, and enhanced status reporting. Thanks to @JimStenstrom.

- Added file content caching to reduce tool confirmation delays and improve performance. Thanks to @JimStenstrom.

- Added path boundary validation to file manipulation tools to prevent directory traversal attacks.

- Added granular debug logging with structured pino logger throughout catch blocks for better error tracking. Thanks to @JimStenstrom and @abhisek1221.

- Added devcontainer support for streamlined development environments. Thanks to @Avtrkrb.

- Added stylized title boxes with powerline-style shapes and real-time preview in custom commands. Thanks to @Avtrkrb.

- Added real-time bash output progress with live updates during command execution.

- Added inline word-level highlighting to string_replace diff display for clearer change visualization.

- Improved code exploration tools with better tool calling prompts and descriptions and new `list_directories` tool. Thanks to @DenizOkcu.

- Centralized token calculation in tools with consistent usage display in formatters. Thanks to @DenizOkcu.

- Added AI SDK error types for better tool call error handling. Thanks to @DenizOkcu.

- Centralized ignored file patterns usage throughout Nanocoder for consistency. Thanks to @DenizOkcu.

- Refactored App component into focused modules (useAppState, useAppInitialization, useChatHandler, useToolHandler, useModeHandlers) for better maintainability.

- Refactored message components to unify structure and fix memoization inconsistency. Thanks to @abhisek1221.

- Refactored handleMessageSubmission into focused handler functions for better code organization. Thanks to @JimStenstrom.

- Refactored health-monitor, log-query, and AISDKClient into smaller focused modules.

- Renamed multiple files to kebab-case for consistency (AISDKClient.ts → ai-sdk-client.ts, appUtils.ts → app-util.ts, conversationState.ts → conversation-state.ts). Thanks to @JimStenstrom.

- Replaced sync fs operations with async readFile for better performance. Thanks to @namar0x0309.

- Improved tool formatter indentation for better readability.

- Extracted magic numbers to named constants for better code clarity. Thanks to @JimStenstrom.

- Enhanced validateRestorePath to check directory writability. Thanks to @yashksaini-coder.

- Fix: Resolved "Interrupted by user" error appearing on empty model responses.

- Fix: Command completion now prioritizes prefix matches over suffix matches for more intuitive autocomplete.

- Fix: Resolved duplicate React keys issue by using useRef for component key counter. Thanks to @JimStenstrom.

- Fix: Development mode context synchronization prevents autoaccept race conditions. Thanks to @JimStenstrom.

- Fix: Bounded completedActions array to prevent memory growth during long sessions. Thanks to @JimStenstrom.

- Fix: User input cycling now works correctly.

- Fix: Slash + Tab now shows all available commands instead of subset.

- Fix: Command injection vulnerabilities in shell commands resolved.

- Fix: Large paste truncation in slow terminals resolved. Thanks to @Alvaro842DEV.

- Fix: find_files tool now correctly recognizes all pattern types.

- Fix: Tool over-fetching in find and search tools reduced for better performance. Thanks to @pulkitgarg04.

- Fix: Prompt history handling improved with better state management.

- Fix: Paragraphs now render correctly in user messages.

- Fix: Added helpful error messages for missing MCP server commands. Thanks to @JimStenstrom.

- Fix: Size limits added to unbounded caches to prevent memory issues.

- Fix: Resolved several security scanning alerts for string escaping and encoding. Thanks to @Avtrkrb.

- Fix: Switched to crypto.randomUUID and crypto.randomBytes for secure ID generation. Thanks to @JimStenstrom and @abhisek1221.

- Fix: Broken pino logging documentation link in README.

- Fix: Husky pre-commit hook configuration improved. Thanks to @Avtrkrb.

- Fix: Silent configuration issues resolved. Thanks to @sanjeev55999999.

- Fix: Added debug logging to empty catch blocks in LSP modules to improve error tracking and debugging. Thanks to @JimStenstrom.

- Fix: Prevented process hang when exiting security disclaimer for better user experience. Thanks to @JimStenstrom.

- Fix: Handled line wrap in read-file metadata test to ensure proper test reliability. Thanks to @JimStenstrom.

- Fix: Use cmd.exe on Windows for command spawning to resolve cross-platform shell issues.

- Fix: LSP diagnostics tool now properly handles non-existent files.

- Fix: /clear command UI display restored.

- Fix: Bun runtime detection added to LoggerProvider. Thanks to @JimStenstrom.

- Fix: Resolved race conditions in singleton patterns and improved VS Code integration.

- Fix: LoggerProvider async loading completion issues resolved.

- Fix: Cleanup timeout leak in LSP client.

- Fix: Duplicate SIGINT handler issues resolved.

- Fix: High severity qs vulnerability patched via pnpm override. Thanks to @Pahari47.

- Fix: Removed line numbers from tagging files and read_file tool as it confused models when pattern matching content changes.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.19.2

- Refactored file editing tools by replacing line-based tools with modern content-based editing for better reliability and context efficiency.

- Replaced `create_file` with `write_file` - a tool for whole-file rewrites, ideal for generated code, config files, complete file replacements and the creation of new files.

- Optimized system prompt to be more concise and reduce token usage.

- Fix: Tool call results were incorrectly being passed as user messages, causing hallucinations in model responses. This has caused great gains for models like GLM 4.6 which commonly struggles with context poisoning.

- Fix: `/usage` command now correctly displays context usage information.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.19.1

- Fix Nix releases.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.19.0

- Added non-interactive mode for running Nanocoder in CI/CD pipelines and scripts. Pass commands via CLI arguments and Nanocoder will execute and exit automatically. Thanks to @namar0x0309.

- Added conversation checkpointing system with interactive loading for saving and restoring conversation state across sessions. Thanks to @akramcodez.

- Added enterprise-grade Pino logging system with structured logging, request tracking, performance monitoring, and configurable log levels. Thanks to @Avtrkrb.

- Switched to Biome for formatting and linting, replacing Prettier and ESLint for faster, more consistent code quality tooling. Thanks to @akramcodez.

- Added Poe.com as a provider template in the configuration wizard. Closes issue #74.

- Added Mistral AI as a provider template in the configuration wizard.

- Updated Ollama model contexts.

- Added `--force` flag to `/init` command for regenerating AGENTS.md without prompting.

- Removed `ink-titled-box` dependency and replaced it with a custom implementation. Closes issue #136.

- Fixed security vulnerabilities by addressing pnpm audit reports. Thanks to @spinualexandru.

- Fixed README table of contents anchors for proper navigation on GitHub forks. Thanks to @Azd325.

- Refactored GitHub Actions workflows to reduce duplication and improve maintainability.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.18.0

- Upgraded to AI SDK v6 beta to improve model and tool calling performance and introduce multi-step tool calls support. Thanks to @DenizOkcu.

- Added `/debugging` command to toggle detailed tool call information for debugging purposes. Thanks to @DenizOkcu.

- Replaced `/recommendations` command with `/model-database` command that provides searchable model information from an up-to-date database, making model recommendations easier to maintain.

- Added GitHub issue templates for bug reports and feature requests to improve community contributions.

- LSP and MCP server connection status is now displayed in the Status component, providing cleaner visibility and removing verbose connection messages from the main UI. Thanks to @Avtrkrb.

- Various improvements to context management, error handling, and code refactoring for better maintainability.

- Fixed locale-related test failures by setting test environment to en-US.UTF-8. Thanks to @DenizOkcu.

- Removed streaming for now as it continued having issues with layouts, flickering and more, especially with the upgrade to AI SDK v6.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.17.3

- Added GitHub models as a provider addressing issue #67 with minimal code changes. Thanks to @JimStenstrom

- Added `/lsp` command to list connected LSP servers. Thanks to @anithanarayanswamy

- Fix: Improve error handling for Ollama JSON parsing. Addresses issue #87. Thanks to @JimStenstrom

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.17.2

- Fix: Remote GitHub MCP Connection Fails with 401 Unauthorized.
- Fix: LSP Server Discovery Fails for Servers Without --version Flag.
- Fix: Model Context Protocol (MCP) Configuration Wizard Fails for Servers with No Input Fields.

^ Thanks to @Avtrkrb for finding and handling these fixes.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.17.1

- Fix: Use virtual documents instead of temp files to prevent linters running on diff previews within the VS Code plugin.

- Fix: Restore terminal focus after showing diff in VS Code plugin.

- Fix Close diff preview when user presses escape to cancel a tool in VS Code plugin.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.17.0

- NEW VS Code extension - complete with live code diffs, diagnostics and more. This is version 1 of this with LSP support. There is a lot more room to expand and improve.

- Several big overhauls and fixes within MCPs - thanks to @Avtrkrb for handling the bulk of this.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.16.5

- `/init` no longer generates an `agents.config.json` file as per new configuration setup.

- Refactoring code to reduce duplication. Thanks to @JimStenstrom.

- Fix: Nix installation was broken. Fixed thanks to @Thomashighbaugh.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.16.4

- Decouple config vs data directories to introduce clear separation between configuration and application data directories. Thanks to @bowmanjd pushing this update.

- Update checker now attempts to detect how you installed Nanocoder and uses that to update with CLI with. It all also presents, update steps to the user correctly to do manually. Thanks to @fabriziosalmi for doing this.

- Added Dracula theme.

- Fix: Command auto-complete would only work if there was just one command left to auto-complete to. Now whatever the top suggestion is is the one it autocompletes to.

- Fix: Improved paste detection to create placeholders for any pasted content (removed 80-char minimum), fixed consecutive paste placeholder sizing, paste chunking for VSCode and other terminals.

- Fix: Creating new lines in VSCode Terminal was broken. This has now been fixed.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.16.3

- Fix: Update checker used old rendering method so it appeared broken and always checking for an update. This has now been resolved.

- Fix: Config files now correctly use `~/.config/nanocoder/` (or platform equivalents) instead of `~/.local/share/nanocoder/`, restoring proper XDG semantic separation between configuration and data. Thanks to @bowmanjd for patching this.

- Fix: Many edge-case fixes in the markdown parser for assistant messages. Outputs are far cleaner now.

- Removed message display limit, you can now see the entire session history. The message queue is very well optimised at this point so we can afford to.

- Removed `read_many_files` tool, it's rarely used by models over `read_file` and provides little benefit.

- Removed `search_files` tool as models often found it confusing for finding files and content.

_In replacement:_

- Added the `find_files` tool. The model provides a pattern and the tool returns matching files and directory paths.

- Added `search_file_contents` tool. The model provides a pattern and the tool returns matching content and metadata for further use.

- Revised `read_file` tool to reveal progressive information about a file. Called on its own, it'll return just file metadata, the model can also choose to pass line number ranges to get specific content.

- Update main prompt to reflect.

_^ All of the above is in effort to better manage context when it comes to models using tools. Some smaller models, like Qwen 3 Coder 30B struggle from intense context rot so these improvements are the first in a set that'll help small models make more accurate and purposeful tool calls._

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.16.2

- Fix: Models returning empty responses after tool execution now automatically reprompted.

- Fix: HTML tags in responses no longer trigger false tool call detection errors.

- `search_files` tool limited to 10 results (reduced from 50) to prevent large outputs
- `execute_bash` output truncated to 2,000 chars (reduced from 4,000) and returns plain string.

- Model context limit tests updated to match actual implementation

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.16.1

- Fix: Removed postinstall hook that caused installation failures due to missing scripts directory in published package. Models.dev data is now fetched on first use instead of during installation.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.16.0

- New `/usage` command! Visually see model context usage. Thanks to @spinualexandru for doing this. Closes issue #12. 🎉

- Added new models to the recommendations database.

- Fix: Model asked for permission to call tools that didn't exist. It now errors and loops back to the model to correct itself.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.15.1

- Fix: Sometimes Ollama returns tool calls without IDs, this caused empty responses occassionally. If no ID is detected, we now generate one.

- Fix: Homebrew installer was not working correctly.

- Fix: Node version requirement is now 20+.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.15.0

- Big: Switched backend architecture to use AI SDK over LangGraph. This is a better fit for Nanocoder for many reasons. Thanks to @DenizOkcu for doing this switch.

- Tag files and their contents into messages directly use the `@` symbol. Nanocoder will fuzzy search and allow to choose which files.

- New message streaming to see agent respond in realtime. Toggle stream mode on and off via the `/streaming` command.

- Added Homebrew installation option.

- Improved command auto-complete by adding fuzzy search.

- Improved table rendering in CLI by switching out the custom renderer for the more robust `cli-table3` library.

- Improved non-native tool call parsing by refining the XML/JSON parsing flow.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.14.3

- Added Nix package installation option. Thanks to @Lalit64 for closing issue #75.
- Chore: bumped `get-md` package version to the latest.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

## 1.14.2

- Fix: issue #71. Markdown tables and HTML entities are now rendering properly in model responses.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

## 1.14.1

- Switched out Jina.ai that fetched LLM optimised markdown from URLs to our own, on-device, private Nano Collective package: [get-md](https://github.com/Nano-Collective/get-md).
- `search_files` tool now ignores contents of `.gitignore` over just a pre-defined set of common ignores.
- If you use OpenRouter as a provider, it now logs "Nancoder" as the agent.
- Fix: Added `parallel_tool_calls` to be equal to `false` in the LangGraph client. This helps bring some stability and flow to models especially when editing files.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

## 1.14.0

- Added `/setup-config` command - an interactive wizard for configuring LLM providers and MCP servers with built-in templates for popular services. Includes real-time validation, manual editing support (Ctrl+E), and automatic configuration reload.
- Revamped testing setup to now:
  - Check formatting with Prettier
  - Check types with tsc
  - Check for linting errors with Eslint
  - Run AVA tests
  - Test for unnused code and dependencies with Knip
- The full test suite passes for version 1.14.0 with no errors or warnings. Nanocoder should feel and work more robustly than ever!

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

## 1.13.9

- Added Anthropic Claude Haiku 4.5 to model database.
- UI updates to welcome message, status and user input placeholder on narrow terminals.
- Updated `CONTRIBUTING.md` and `pull_request_template.md` to reflect new testing requirements.
- Fix: Declining a tool suggestion and then sending a follow up message caused an error.
- Fix: Removed duplicate `hooks` directories and consolidated into one.
- Fix: Removed unneccessary `ollama` package.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

## 1.13.8

- Fix: Issue #55
- Rolling out testing to the release pipeline

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

## 1.13.7

- Updated `LICENSE.md` to be `MIT License with Attribution`. This was done to keep the spirit of MIT but also ensure the technology built by contributors is properly credited.
- We added a new system prompt with better instructions, ordering, tool documentation and included system information.

  - Old system prompts are dated using the following format: `yyyy-mm-dd-main-prompt.md` where the date is when the prompt was retired.

- Fix: import aliases within the code now use `@/` syntax _without_ file extensions. This is an under-the-hood refactor to improve code readability and use more modern standards.
- Fix: All but the last message in the chat was made static through Ink. This still causes _some_ terminal flicker if the last message was a long one. All messages are immediately made static now to further improve performance.

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

## 1.13.6

- Added `CHANGELOG.md` and rolled out changelogs to releases.
- Updated the `/clear` command output UI to read "Chat Cleared." over "✔️ Chat Cleared..."
- Refactored `langgraph-client.ts` to removed old methods that are no longer needed. Rolled out this change to `useChatHandler.tsx`. This results in smaller, more tidy files.
- Fix: LangGraph errors leaked through to UI display. This is now tidied to be from Nanocoder.
- Fix: Pressing Escape to cancel model responses was not instant and sometimes didn't work.
