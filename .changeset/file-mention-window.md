---
"@nanocollective/nanocoder": patch
---

Fixed the `@` file mention list losing its highlight after the fifth suggestion, which let Tab insert a file that was never shown. The list now scrolls with the selection and shows "Showing X-Y of Z" when there are more than five matches, like the slash command list. Closes #1405.
