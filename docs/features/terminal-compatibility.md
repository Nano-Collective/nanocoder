---
title: "Terminal Compatibility Checks"
description: "Reproducing modified Enter and external-editor handoff checks"
---

# Terminal Compatibility Checks

These checks distinguish byte-sequence regression coverage from interaction with a real terminal. An automated parser or Ink rendering test does not establish that VS Code emits the expected bytes or that an external editor receives a usable terminal.

## Related input issues

- [#1505](https://github.com/Nano-Collective/nanocoder/issues/1505): Backspace acted as forward Delete on published installations. Main fixed the dependency on patched `key.raw` in [#1670](https://github.com/Nano-Collective/nanocoder/pull/1670). The Ink upgrade must retain that patch-independent behavior and its regression guard.
- [#1664](https://github.com/Nano-Collective/nanocoder/issues/1664): another Backspace report involving Konsole and VS Code. This is related coverage, not a claim that upgrading Ink is required to fix that report.

## Automated coverage

Run from the repository root:

```sh
pnpm run test:types
pnpm run test:ava source/utils/terminal-keypress.spec.ts source/utils/terminal-input.spec.ts source/utils/terminal-paste.spec.ts source/utils/newline-key.spec.ts source/components/text-input-keys.spec.tsx source/components/text-input-newline.spec.tsx source/components/input-swap.spec.tsx source/components/user-input.spec.tsx
pnpm run test:ava source/wizards/base-config-wizard.spec.tsx source/wizards/steps/mcp-step.spec.tsx
```

These suites cover modified Enter (including fragmented reads), ordinary Enter, Backspace versus forward Delete, keys interleaved with bracketed paste, focused paste targets, and input after a same-commit component swap. They do not replace either manual check below. Run each command only on the branch that contains the referenced feature and tests; a minimal Ink-upgrade PR need not include the paste/FIFO suites.

## VS Code integrated-terminal smoke test

1. Build with `pnpm run build`. Launch `node dist/cli.js` inside the VS Code integrated terminal, not the VS Code extension's separate chat view. Record VS Code version, OS, shell, and Nanocoder commit.
2. Record the existing terminal keybindings. For the xterm rewrite check, temporarily use `workbench.action.terminal.sendSequence` with `"when": "terminalFocus"`, mapping Shift+Enter to `"\u001b[27;2;13~"` and Alt+Enter to `"\u001b[27;3;13~"`. Testing only a binding that sends `"\n"` does not exercise that rewrite.
3. Type `ab`, move the caret between the letters, press Shift+Enter, then type `x`. The result must be `a\nxb`, with no submission and no literal escape-sequence text. Repeat with Alt+Enter and with Ctrl+J.
4. Check Backspace and Delete in the middle of `abc`: Backspace removes the character to the left; Delete removes the character to the right. Repeat beside an emoji.
5. Paste a multiline block between typed characters, then type immediately afterwards. The surrounding text must stay in order and the paste must not submit. Test the MCP wizard's env-vars field separately if the paste-target change is present.
6. Verify plain Enter still submits only when intended, then restore the original keybindings. Repeat in inline mode (`--no-alt-screen`).

## External-editor handoff smoke test

Use a disposable workspace and configuration directory without credentials. Select a terminal editor such as `vi` as the editor for the configuration wizard; a GUI editor does not exercise raw/cooked terminal handoff.

1. In the configuration wizard, reach the review step and choose its external-editor action. Record the editor version, OS, terminal, and Nanocoder commit.
2. Confirm that the editor accepts normal typing, cursor movement, and multiline paste without literal paste/mouse escape sequences. Save a harmless configuration change and quit.
3. Confirm that the wizard repaints and responds to keys after the editor exits. Try a second handoff and an exit without saving; check that each returns control to the wizard.
4. Repeat in fullscreen and inline modes. After leaving Nanocoder, check that the shell echoes input normally and that paste markers and mouse-report bytes do not appear as text.

## Reporting results

For each manual check, report the commit, OS, terminal/editor versions, keybinding sequences, screen mode, and observed result in the PR. Mark unperformed checks **not run**. In particular, do not report the external-editor handoff or real VS Code interaction as verified solely because the automated suites passed.
