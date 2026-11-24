---
"@nanocollective/nanocoder": patch
---

Fix HTML entities in assistant messages being decoded wrong: numeric entities for emoji and other characters above U+FFFF (`&#128512;`, `&#x1F600;`) now show the right character, and an escaped entity such as `&amp;lt;` is shown as `&lt;` instead of being decoded a second time. Thanks to @Kidkender. Closes #2325.
