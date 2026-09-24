---
"@nanocollective/nanocoder": patch
---

A model stuck calling a tool that does not exist now trips `nanocoder.retries.maxRepeatedToolCalls` as intended: the TUI asks whether to continue after three identical calls and `--plain` stops with an error. The AI SDK was answering each unknown call itself and looping up to ten steps inside a single request, so nanocoder never saw those calls and the cap never applied.
