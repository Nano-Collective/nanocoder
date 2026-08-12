---
'@nanocollective/nanocoder': patch
---

Fixed the unreadable selection highlight in the setup wizards and other list selectors. `ink-select-input`'s built-in indicator and selected-label renderer hardcode a dark `blue` that ignores the active theme and all but vanishes against a dark terminal; every selector now routes through `StyledSelectInput` and highlights with the theme's `primary` colour instead. Also raised five themes whose highlight or body text fell below WCAG AA contrast against their own background (cherry-blossom, ayu-light, everforest-light, volcanic-ash, solarized-light). Closes #827.
