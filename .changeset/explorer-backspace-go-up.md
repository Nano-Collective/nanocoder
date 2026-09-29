---
'@nanocollective/nanocoder': patch
---

Backspace in `/explorer` now goes up a level. On a directory you have opened it collapses that directory; anywhere else it moves the selection to the parent row. It used to collapse the parent of whatever was highlighted instead, so it did nothing on a top-level directory, hid the directory you had just opened on a nested one, and left the selection on an unrelated row. On Windows it did nothing at all, because it split paths on `/` while the tree builds them with `\`. The tree view's help line now lists the shortcut. Closes #1455.
