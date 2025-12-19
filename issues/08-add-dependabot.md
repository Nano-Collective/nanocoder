# Add Dependabot configuration

## Priority: Medium

## Description

The repository lacks automated dependency update configuration. Dependencies can become outdated, potentially missing security patches.

## Location

`.github/dependabot.yml` - needs to be created

## Proposed Solution

Create `.github/dependabot.yml`:

```yaml
version: 2
updates:
  # npm dependencies
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
    groups:
      dev-dependencies:
        dependency-type: "development"
      production-dependencies:
        dependency-type: "production"

  # GitHub Actions
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
```

## Acceptance Criteria

- [ ] Dependabot configured for npm dependencies
- [ ] Dependabot configured for GitHub Actions
- [ ] Updates grouped to reduce PR noise
- [ ] Weekly update schedule configured
