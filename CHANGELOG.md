# 1.19.0

- Added non-interactive mode for running Nanocoder in CI/CD pipelines and scripts. Pass commands via CLI arguments and Nanocoder will execute and exit automatically. Thanks to @namar0x0309.

- Added `--force` flag to `/init` command for regenerating AGENTS.md without prompting.

- Added Poe.com as a provider template in the configuration wizard. Closes issue #74.

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

- Fix: Command auto-complaete would only work if there was just one command left to auto-complete to. Now whatever the top suggestion is is the one it autocompletes to.

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
