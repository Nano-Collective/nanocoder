---
"@nanocollective/nanocoder": patch
---

Typing an option without its dashes, such as `nanocoder acp`, now suggests the option (`Did you mean "--acp"?`) instead of only reporting an unknown command. The ACP docs also gain a "Setup in Xcode" section. Closes #1868.
