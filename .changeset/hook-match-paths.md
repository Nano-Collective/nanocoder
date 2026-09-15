---
"@nanocollective/nanocoder": minor
---

Add `matchPaths` to lifecycle hooks, so a hook can be scoped to the file a tool acted on and not just the tool name. This is what lets one formatter per language be declared directly — `{"matchTools": ["write_file", "string_replace"], "matchPaths": ["**/*.{ts,tsx}"], "command": "npx prettier --write \"$NANOCODER_FILE\""}` — instead of dispatching on the extension inside the command with a `case` statement, which was the only option before and is not portable to Windows. It applies to any file-scoped hook, not just formatting: "only lint `src/**`", "audit-log writes under `infra/`". Patterns use the same glob dialect as skill subscriptions (`**`, `*`, `?`, `{a,b}`), and the file is whichever of `path`, `file_path` or `filePath` the tool was called with.

Two deliberate behaviours: a hook scoped by path does not fire for a tool that touched no file (`execute_bash`), since `matchPaths` asks a question about a file and excluding is the right answer rather than waving it through — the opposite of an omitted `matchTools`, which widens to every tool; and an absolute path is also matched relative to the project root, so a root-anchored pattern like `src/**` fires whether the model wrote `src/a.ts` or the absolute form for the same edit.
