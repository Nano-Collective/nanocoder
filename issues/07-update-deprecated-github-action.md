# Update deprecated GitHub Actions

## Priority: High

## Description

The release workflow uses `actions/create-release@v1` which has been deprecated by GitHub and is no longer maintained.

## Location

`.github/workflows/release.yml:114`

## Proposed Solution

Replace with `softprops/action-gh-release@v2`:

```yaml
# Before
- name: Create Release
  uses: actions/create-release@v1
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  with:
    tag_name: ${{ github.ref }}
    release_name: Release ${{ github.ref }}
    draft: false
    prerelease: false

# After
- name: Create Release
  uses: softprops/action-gh-release@v2
  with:
    generate_release_notes: true
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Acceptance Criteria

- [ ] Deprecated action replaced with maintained alternative
- [ ] Release workflow still creates releases correctly
- [ ] Release notes are generated properly
- [ ] No manual intervention required for releases
