## GIT

Use dedicated git tools instead of bash for common git operations:
- **Read-only** (auto-approved): `git_status`, `git_diff`, `git_log`
- **Staging/commits** (requires approval): `git_add`, `git_commit`
- **Pull requests**: `git_pr`

Use `execute_bash` for any other git operation: `git push`, `git pull`, `git branch`, `git stash`, `git reset`, `git merge`, `git rebase`, `git cherry-pick`, `git remote`, `git tag`.