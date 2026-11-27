---
"@nanocollective/nanocoder": patch
---

`/usage` no longer shows "—" for Cumulative Session once any call in the session used a model without a price. Unpriced calls are left out of the totals, so the priced calls still add up, and a total that leaves calls out says "(excludes unpriced calls)". In the per-provider breakdown, a provider shows the cost of its priced calls, and "—" only when none of its calls has a price. The totals no longer depend on the active model, so switching to an unpriced or local model keeps them. Free local calls beside an unpriced hosted call leave the total at "—" rather than $0.00. Closes #2390.
