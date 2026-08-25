---
"@nanocollective/nanocoder": minor
---

Syntax highlighting now follows the active theme, so code renders in the palette you picked instead of `cli-highlight`'s own colours. All five highlighting call sites - markdown code blocks, `string_replace` diff context, the `write_file` preview, and the file explorer preview - passed `theme: 'default'`, a string where the library expects a token-to-formatter map, so the option was silently dropped and every theme rendered code identically. Each one now derives its token map from the theme's colours: keywords take `primary`, built-ins and declarations `tool`, strings `success`, numbers `warning`, comments `secondary`, attributes and variables `info`, and everything else the theme's body `text`. Picking a theme via `/settings`, or setting `selectedTheme` in `nanocoder-preferences.json`, recolours code along with the rest of the UI. Closes #935.
