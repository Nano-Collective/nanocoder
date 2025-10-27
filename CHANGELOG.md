# 1.14.1

- Enforce reading files before editing them

# 1.14.0

- Added `/setup-config` command - an interactive wizard for configuring LLM providers and MCP servers with built-in templates for popular services. Includes real-time validation, manual editing support (Ctrl+E), and automatic configuration reload.
- Revamped testing setup to now:
  - Check formatting with Prettier
  - Check types with tsc
  - Check for linting errors with Eslint
  - Run AVA tests
  - Test for unnused code and dependencies with Knip
- The full test suite passes for version 1.14.0 with no errors or warnings. Nanocoder should feel and work more robustly than ever!

If there are any problems, feedback or thoughts please drop an issue or message us through Discord! Thank you for using Nanocoder. 🙌

# 1.13.9

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
