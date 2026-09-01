---
"@nanocollective/nanocoder": patch
---

Fixed skill subscriptions never firing for a brace pattern such as `*.{ts,tsx}`. The event router's glob matcher escaped `{`, `}` and `,` as literals, so the pattern only matched a path that literally contained the braces. Braces now expand to an alternation, and an unbalanced brace stays literal rather than building a regex that would throw. Negation (`!`) is still unsupported. Closes #1012.
