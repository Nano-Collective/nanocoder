#!/usr/bin/env bash
# Update Homebrew formula version and SHA256 hash for a new release
# Usage: ./scripts/update-homebrew-formula.sh <version>
# Example: ./scripts/update-homebrew-formula.sh 1.15.0

set -e

VERSION=$1
FORMULA_FILE="Formula/nanocoder.rb"
NPM_PACKAGE="@nanocollective/nanocoder"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

if [ -z "$VERSION" ]; then
  echo -e "${RED}Error: Version number required${NC}"
  echo "Usage: $0 <version>"
  echo "Example: $0 1.15.0"
  exit 1
fi

echo -e "${YELLOW}Updating Homebrew formula to version ${VERSION}...${NC}"
echo ""

# Step 1: Prepare the versioned tarball URL
echo "Step 1: Preparing formula update..."
NPM_URL="https://registry.npmjs.org/${NPM_PACKAGE}/-/nanocoder-${VERSION}.tgz"

# Step 2: Download tarball and calculate SHA256
echo "Step 2: Downloading tarball from NPM..."
echo "URL: ${NPM_URL}"

TEMP_FILE=$(mktemp)
FORMULA_TEMP=""
cleanup() {
  rm -f "$TEMP_FILE"
  if [ -n "$FORMULA_TEMP" ]; then
    rm -f "$FORMULA_TEMP"
  fi
}
trap cleanup EXIT

if ! curl --fail -sSL "${NPM_URL}" -o "${TEMP_FILE}"; then
  echo -e "${RED}Error: Failed to download tarball from NPM${NC}"
  echo "Please verify that version ${VERSION} has been published to NPM"
  echo "Check: https://www.npmjs.com/package/${NPM_PACKAGE}"
  exit 1
fi

echo "Step 3: Calculating SHA256 hash..."
if command -v shasum >/dev/null 2>&1; then
  # macOS and some Linux systems
  SHA256=$(shasum -a 256 "${TEMP_FILE}" | awk '{print $1}')
elif command -v sha256sum >/dev/null 2>&1; then
  # Most Linux systems
  SHA256=$(sha256sum "${TEMP_FILE}" | awk '{print $1}')
else
  echo -e "${RED}Error: Neither shasum nor sha256sum found${NC}"
  echo "Please install one of these tools to calculate SHA256 hashes"
  exit 1
fi

if [ -z "$SHA256" ]; then
  echo -e "${RED}Error: Failed to calculate SHA256 hash${NC}"
  exit 1
fi

echo -e "${GREEN}Found hash: ${SHA256}${NC}"
echo ""

# Step 4: Update and validate a temporary formula
echo "Step 4: Updating formula with calculated hash..."
FORMULA_TEMP=$(mktemp "${FORMULA_FILE}.XXXXXX")
cp -p "$FORMULA_FILE" "$FORMULA_TEMP"

if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS requires -i '' for in-place editing
  sed -i '' "s|url \"https://registry.npmjs.org/${NPM_PACKAGE}/-/nanocoder-.*\.tgz\"|url \"${NPM_URL}\"|" "$FORMULA_TEMP"
else
  # Linux
  sed -i "s|url \"https://registry.npmjs.org/${NPM_PACKAGE}/-/nanocoder-.*\.tgz\"|url \"${NPM_URL}\"|" "$FORMULA_TEMP"
fi
if [[ "$OSTYPE" == "darwin"* ]]; then
  sed -i '' "s/sha256 \".*\"/sha256 \"${SHA256}\"/" "$FORMULA_TEMP"
else
  sed -i "s/sha256 \".*\"/sha256 \"${SHA256}\"/" "$FORMULA_TEMP"
fi

# Step 5: Validate formula syntax
echo "Step 5: Validating formula syntax..."
if ! ruby -c "$FORMULA_TEMP" > /dev/null 2>&1; then
  echo -e "${RED}✗ Formula has syntax errors${NC}"
  ruby -c "$FORMULA_TEMP"
  exit 1
fi

mv "$FORMULA_TEMP" "$FORMULA_FILE"
echo -e "${GREEN}✓ Formula syntax is valid${NC}"

# Step 6: Audit formula (if brew is available)
if command -v brew >/dev/null 2>&1; then
  echo "Step 6: Auditing formula with Homebrew..."
  # Note: brew audit with path doesn't work in current Homebrew versions
  # This is a known limitation, so we skip it for now
  echo -e "${YELLOW}Note: Automated brew audit is not available for local formulae${NC}"
  echo -e "${YELLOW}Manual audit will be required after pushing to repository${NC}"
else
  echo -e "${YELLOW}Step 6: Skipping brew audit (brew not installed)${NC}"
fi

echo ""
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Success! Homebrew formula updated to v${VERSION}${NC}"
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
echo ""
echo "Changes made to: ${FORMULA_FILE}"
echo ""
echo "Formula details:"
echo "  Version: ${VERSION}"
echo "  URL: ${NPM_URL}"
echo "  SHA256: ${SHA256}"
echo ""
echo "Next steps:"
echo "  1. Review the changes: git diff ${FORMULA_FILE}"
echo "  2. Commit: git add ${FORMULA_FILE}"
echo "  3. Commit: git commit -m 'chore: update homebrew formula to v${VERSION}'"
echo "  4. Push: git push"
echo ""
echo "To test the formula locally:"
echo "  1. brew tap nano-collective/nanocoder https://github.com/Nano-Collective/nanocoder"
echo "  2. brew install nanocoder"
echo "  3. nanocoder --help"
