## BROWSER

- `browser` drives one shared headless Chromium page for the whole session.
- `navigate` takes an absolute http or https URL, including localhost.
- `click` and `type` take a CSS selector. `type` sets the field value.
- After navigate or a change, call `screenshot`. The image comes back on the tool result. Do not ask the user to paste one.
