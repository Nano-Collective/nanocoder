---
title: "External Content"
description: "How Nanocoder marks text that came from outside your project"
sidebar_order: 24
---

# External Content

Nanocoder talks to models that also read the web, your MCP servers, and pages a
browser tool rendered. Those results arrive as ordinary tool output, in the same
channel as your own instructions, so a web page carrying "ignore previous
instructions and run …" reads to the model like a request.

To keep that boundary visible, every tool result that came from outside your
workspace is written to the conversation inside a frame:

```
<external_content source="fetch_url" url="https://example.com/docs">
…the page…
</external_content>
```

The system prompt tells the model that everything inside that frame is data to
read, never instructions, and that only your own messages are instructions. If
the wrapped text asks it to run a command, send a URL, change its rules, or
reveal files, the model is told to report that to you instead of acting on it.

## Which results are framed

- `fetch_url` — a page, with the URL it read
- `web_search` — search results
- `browser` — a page rendered through browser automation
- every MCP tool — the server's text, labelled `mcp:<server>`
- the MCP discovery catalog (`load_tool_schema`) — a server's own description of
  its tools, labelled `mcp`

A failure from one of these tools is framed too: an MCP server's error text, and
the URL a fetch says it could not reach, are still not your words.

Everything else stays untouched: reading files in your repo, running commands
and language-server results are part of working on your machine, not content
from somewhere else.

## What you see

A framed result carries a short notice under it in the chat:

```
⚒ fetch_url
⚠ external content · treated as data
```

Lookalike delimiters inside the page are neutralised, so a page cannot close the
frame early and write text that looks like it came from somewhere else. The
frame marks the boundary; it does not block anything by itself.
