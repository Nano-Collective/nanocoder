---
"@nanocollective/nanocoder": patch
---

Fixed an XML tool call that holds a tag with its own name, such as a parameter named after the tool (`<read_file><read_file>a.ts</read_file></read_file>`), being cut short. The parser ended the call at the first closing tag with its name, which belongs to the inner tag, so the call went back to the model as broken, with a message about a tag that was in fact closed (before #2162 it ran with the wrong arguments), and removing it from the reply text left a stray closing tag behind. The call now ends at the closing tag that pairs with its opening tag, so the inner tag is read as a parameter and a complete example of the same call inside a `write_file` content stays in that content. A call left open still ends at the first closing tag, so it never runs on into the next call to the same tool.
