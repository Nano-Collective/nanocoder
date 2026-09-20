---
"@nanocollective/nanocoder": minor
---

Added `/repomap`, a local codebase map. Nanocoder indexes the symbols defined in each source file, links files that reference each other's symbols into a directed graph, and ranks that graph with PageRank - so the map leads with the files the rest of the codebase leans on most. Everything runs on your machine with no LLM round-trip, covering TypeScript/JavaScript, Python, Go, Rust, Java/Kotlin/C#/Swift, Ruby, PHP, and C/C++. The map is budgeted to 1024 tokens by default; `/repomap --tokens <n>` widens it. Thanks to @akramcodez. Refs #890.
