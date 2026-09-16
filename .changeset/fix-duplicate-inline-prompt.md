---
'@nanocollective/nanocoder': patch
---

Fix duplicate user prompt rendering in inline mode when streaming begins. In default inline mode (where output is backed by Ink's `<Static>` component), holding the submitted prompt in a live recallable preview caused the message to first render in the dynamic terminal area. Once the model began streaming and the recall window closed, moving the prompt into the `<Static>` component triggered Ink to reprint the component directly into stdout, duplicating the prompt in the terminal scrollback. `renderLastQueuedComponentLive` is now gated to fullscreen (alt-screen) mode where `<Static>` is disabled and rendering occurs inside a virtual scrolling viewport.
