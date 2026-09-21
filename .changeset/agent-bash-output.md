---
"@nanocollective/nanocoder": minor
---

Added a `showAgentBashOutput` preference (`/settings` → Behavior → Tool Results and Thinking). By default a completed card for a command the agent runs shows the command and its status, and the command output is not kept; with compact tool display on, the card collapses into a tally line. This preference shows the output on that card, whether compact tool display is on or off, and for failed commands too. Commands you type yourself (`!command`) always show their output and are unaffected.
