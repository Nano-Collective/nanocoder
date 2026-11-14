---
"@nanocollective/nanocoder": patch
---

The VS Code chat panel now sanitizes rendered markdown before showing it. Replies, thoughts and replayed user messages used to go from marked straight into the page, so raw HTML in a reply could restyle or cover the panel. Markdown now passes through a bundled copy of DOMPurify, which drops scripts, event handlers, `<style>`, `style=""`, forms, SVG and any class other than a code block's `language-*`. If the sanitizer fails to load, the panel shows the plain text instead. The panel's content security policy also no longer allows remote `https:` images, so a reply cannot make the editor fetch a tracking pixel; pasted and uploaded images still show. Closes #1727.
