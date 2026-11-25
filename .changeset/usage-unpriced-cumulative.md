---
"@nanocollective/nanocoder": patch
---

`/usage` no longer shows "—" for Cumulative Session or for a provider subtotal when only some of the calls used a model without a models.dev price. Unpriced calls are left out of the totals, and "—" remains for a total with no priced call, such as a provider whose calls were all unpriced. Closes #2390.
