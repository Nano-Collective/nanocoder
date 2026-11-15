---
"@nanocollective/nanocoder": minor
---

The VS Code extension no longer spawns `nanocoder --acp` in every VS Code window. It used to start the agent process as soon as the window finished starting up, using memory and CPU even in windows where Nanocoder was never opened. The extension still activates at startup, so the `Explain Code` / `Generate Tests` lenses and the status bar item appear right away, but the agent process is now spawned the first time the chat view opens. That covers every command that needs the agent: Explain Code and Generate Tests open the chat view first, and New Chat, History and Settings are buttons on the chat view itself. Commands that don't talk to the agent (Open Configuration, Show Output, Copy Last Code Block, Cancel, the legacy companion) no longer start it. Closes #1729.
