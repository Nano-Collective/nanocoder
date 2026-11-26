---
"@nanocollective/nanocoder": patch
---

`/usage` no longer shows "—" for Cumulative Session once any call in the session used a model without a price. Unpriced calls are left out of the totals, so the priced calls still add up. In the per-provider breakdown, a provider shows the cost of its priced calls, and "—" only when none of its calls has a price. Closes #2390.
