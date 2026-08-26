---
"@nanocollective/nanocoder": patch
---

Fixed **Done & Save** in the provider wizard not saving. It routed to the Configure Mode-Specific Providers screen, which a first run has nothing to say to: a user who had just entered one API key was shown four modes marked `(Unconfigured)` and had to find the `Done` row before reaching the summary. Mode-specific providers are now an opt-in `Configure mode-specific providers` entry in the provider menu that returns you to that menu when you're finished, and **Done & Save** goes straight to the summary. Mode providers already in the config are carried through a save that skips the step.
