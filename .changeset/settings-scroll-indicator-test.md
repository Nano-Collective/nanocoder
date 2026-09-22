---
"@nanocollective/nanocoder": patch
---

Re-enabled the `/settings` scroll-indicator test. It was skipped because no tab exceeded the four visible rows, so the indicator could not be triggered organically, with a note to restore it once one did. That happened this cycle: Appearance gained Alternate Screen and Mouse Wheel Reporting alongside the fullscreen TUI and now has five rows, and Behavior and Advanced have six each. The settings window is the busiest it has been and had no coverage of its own scrolling; the test now also asserts the hidden-row count rather than only the label, so an off-by-one in the window arithmetic fails it.
