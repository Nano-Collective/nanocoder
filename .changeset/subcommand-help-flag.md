---
"@nanocollective/nanocoder": patch
---

`--help` and `-h` now print usage and exit 0 for `nanocoder daemon`, every `daemon` subcommand, `nanocoder skills` and `nanocoder verify`, instead of reporting an unknown flag. A `daemon` subcommand given `--help` no longer runs, so `nanocoder daemon install --help` no longer installs the auto-start unit.
