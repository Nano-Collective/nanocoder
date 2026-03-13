---
description: Check for new GitHub issues from the last day and generate spec/plans to close them
---

# Scheduled Task: Daily Issue Check

You are running the daily issue-check scheduled task for the Nano-Collective/nanocoder repository.

## Your Goal

Check for new GitHub issues created in the last 24 hours and generate a spec/plan for each one.

## Steps to Execute

1. **Fetch recent open issues**: Use the `gh` CLI or GitHub API to list all open issues created since yesterday. Filter to only include issues with `created:>=(date from 1 day ago)`. Do not include open pull requests. We're only checking issues.

2. **For each new issue found**:
   - Read the full issue content (title, body, comments, labels)
   - **Skip if already planned**: Check if `.github/issues/docs/{issue-number}-{slug}.md` already exists. If it does, skip this issue and report "Already planned: #{issue-number}"
   - Analyze what needs to be done to resolve it:
     - If it's a bug: Identify the root cause and the fix
     - If it's a feature: Design the implementation approach, changes, and acceptance criteria
   - Write a spec/plan document in Markdown

3. **Save the plan**: For each issue, create a file at `.github/issues/docs/{issue-number}-{slug}.md` where:
   - `{issue-number}` is the GitHub issue number
   - `{slug}` is a short URL-safe version of the issue title ( kebab-case, max 50 chars)
   - The file should contain:
     - Original issue link and title
     - Issue type (bug/feature/other)
     - Analysis summary
     - Proposed plan with steps to fix/implement in order to close the issue
     - Any technical considerations or questions
     - **Recommended next steps for the maintainer**: Specific action(s) to take (e.g., close the issue, add a comment asking for clarification, label it, assign it, etc.)

## Output

- Report how many new issues were found
- Report how many were skipped (already planned)
- For each new issue, confirm the plan file was created and show its path
- For each skipped issue, show "Already planned: #{issue-number}"
- If no new issues found, report "No new issues found"

## Notes

- Only create plans for issues that have enough detail to work with
- If an issue is unclear or needs more info, note this in the plan and recommend asking for clarification
- Use existing code patterns in the repository as reference when writing plans
- When recommending next steps, consider: closing (if resolved/wontfix), adding labels, asking for clarification, marking as help wanted, or assigning