# Add CI test workflow for pull requests

## Priority: Critical

## Description

Currently, there is no GitHub Actions workflow that runs tests on pull requests. PRs can be merged without automated testing, which is a significant quality and security gap.

## Location

`.github/workflows/` - needs new file

## Proposed Solution

Create `.github/workflows/test.yml`:

```yaml
name: Test

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm run test:all
```

## Acceptance Criteria

- [ ] Tests run automatically on PR creation and updates
- [ ] Tests run on push to main branch
- [ ] PR cannot be merged if tests fail (requires branch protection rule)
- [ ] Workflow uses same test command as release pipeline
