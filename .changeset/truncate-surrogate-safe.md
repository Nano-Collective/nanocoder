---
"@nanocollective/nanocoder": patch
---

Fix shortened text sometimes ending in a broken character when the cut landed inside an emoji or other character outside the Basic Multilingual Plane. This affected ACP tool-call titles, tool descriptors in replayed session history, and the line previews for `string_replace` and `write_file`. The cut now stops before the whole character.
