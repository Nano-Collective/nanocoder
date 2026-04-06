## GIT

Use dedicated git tools instead of bash for common git operations:
- **Read-only** (auto-approved): `git_status`, `git_diff`, `git_log`
- **Staging/commits** (requires approval): `git_add`, `git_commit`, `git_push`
- **Branch management**: `git_branch`, `git_pull`, `git_stash`, `git_reset`, `git_pr`

Reserve bash for git operations not covered by dedicated tools: `git merge`, `git rebase`, `git cherry-pick`, `git remote`, `git tag`.