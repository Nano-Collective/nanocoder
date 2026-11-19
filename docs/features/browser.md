---
title: "Browser Tool"
description: "Let the model drive a headless Chromium page and see screenshots of it"
sidebar_order: 19
---

# Browser Tool

The built-in `browser` tool lets the model open a web page, click and type on it, and take screenshots it can look at. It is useful for checking a local dev server, reproducing a UI bug, or confirming that a layout change looks right.

All calls share one headless Chromium page with a 1280x720 viewport, so a `navigate` followed by a `click` and a `screenshot` act on the same page. If the browser crashes or is closed, the next call launches a fresh one. The browser is closed when Nanocoder exits.

## Actions

The tool takes an `action` plus the arguments that action needs:

- `navigate` - opens `url`, which must be an absolute `http` or `https` URL.
- `click` - clicks the element matching the CSS `selector`.
- `type` - sets the value of the field matching `selector` to `text`. An empty `text` clears the field.
- `screenshot` - captures the current page as a JPEG and returns it to the model as an image, with a caption naming the URL and page title.

## Installing Chromium

The `playwright-core` package ships with Nanocoder, but the Chromium browser it drives does not. The first time the tool runs without Chromium installed, it fails with the command to run, pinned to the `playwright-core` version Nanocoder bundles:

```bash
npx playwright-core@<version> install chromium
```

On Linux, add `--with-deps` to also install the system libraries Chromium needs. Use the command exactly as the error prints it: an unpinned `npx playwright install` fetches the latest Playwright, whose browser revision may not be the one Nanocoder launches.

## Approval

`browser` prompts for approval before each call in normal, auto-accept and architect modes, the same as `execute_bash`. It runs without a prompt in yolo mode, in daemon-triggered (headless) runs, and when `browser` is listed in [`nanocoder.alwaysAllow`](../configuration/index.md#tool-auto-approval). Plan mode removes the tool entirely. See [Development Modes](development-modes.md).

## Network Restrictions

The tool uses the same address checks as `fetch_url`, except that loopback is allowed so you can test a local dev server:

- `localhost`, `*.localhost`, `127.x.x.x` and `::1` are allowed.
- Private network addresses, reserved, multicast and broadcast IPv4 ranges, and cloud metadata addresses (such as `169.254.169.254`) are blocked, as are IPv6 addresses that embed any of these or a loopback address (IPv4-mapped, IPv4-compatible, IPv4-translated, NAT64 and 6to4).
- Hostnames are resolved before loading, so a public name that points at a private or metadata address (for example `169.254.169.254.nip.io`) is blocked too.
- The check applies to the `navigate` URL, to every request the page makes (subresources, iframes, `fetch`, link clicks), and to where each frame lands after redirects.

A blocked navigation fails with an error naming the address. DNS rebinding between Nanocoder's lookup and Chromium's own is not prevented.

## Screenshots and Vision Models

Screenshots reach vision-capable models as images. On OpenAI-compatible providers, the image follows the tool result as a separate image message.

Models that [models.dev](https://models.dev) lists as text-only get the caption without the image. Models that models.dev does not list still get screenshots. If the provider rejects a request because it carries images, Nanocoder retries it once without them and leaves images out of later requests to that model for the rest of the session, so a text-only local model does not get stuck on a screenshot in its history.
