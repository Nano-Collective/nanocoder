---
'@nanocollective/nanocoder': patch
---

An emoji in the prompt no longer desyncs the caret. The cursor was drawn by counting code points while every offset the edit keys used counted UTF-16 units, and an emoji is one of the former but two of the latter. With `😀abc` in the composer the caret vanished on the first Left, then sat on the wrong character, and Backspace or Delete could split the emoji's surrogate pair and leave a lone surrogate in the message. The caret now renders on the right character, and Left, Right, Ctrl+B, Ctrl+F, Backspace, Delete and Up/Down all move over or remove an emoji as one character. Closes #1452.
