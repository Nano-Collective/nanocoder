---
"@nanocollective/nanocoder": minor
---

- **Added a native VS Code GUI**. The VS Code extension now ships a sidebar chat powered by the Agent Client Protocol (ACP): the extension spawns and manages `nanocoder --acp` itself - nothing to run in a terminal. Responses stream with collapsible thinking sections, tool activity renders as live cards, and file edits open in VS Code's diff viewer. Thanks to @akramcodez.
- **Sessions in the GUI**: conversations persist to disk, with a New Chat action, a session history view with resume and delete, and full thread replay (including thinking and completed tool cards) on resume.
- **Provider, model, and mode switching** from dropdowns in the chat header, with the model list refreshing on provider switch.
- **Slash commands in the GUI**: `/help`, `/clear`, and custom commands from `.nanocoder/commands`; CLI-only commands explain themselves, and messages starting with file paths are not mistaken for commands.
- **Interactive tools in the GUI**: `ask_user` questions render with one button per answer; tool approvals show Approve/Deny inline.
- **Live progress**: subagent runs stream token/tool counts onto their card, and the task tool (`write_tasks`) renders as a live checklist via ACP `plan` updates - which also lights up in other ACP clients like Zed.
- **Cancellation**: Stop ends the whole turn - the current tool aborts, queued tools are skipped, and no follow-up model request is issued.
- **Robust CLI spawning**: the extension resolves the login shell's PATH (nvm-friendly when VS Code launches from the Dock), runs the CLI in the workspace folder, validates `nanocoder.cliPath`, and surfaces the last stderr line in the crash dialog. Fixed a silent `--acp` startup crash when the working directory was unwritable.
- **Legacy WebSocket companion mode is now opt-in** (`nanocoder.autoConnect` defaults to off); extension docs rewritten around the GUI.
