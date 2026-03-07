#!/bin/bash

# Script to test GitHub Copilot integration
# This tests the complete workflow from login to usage

set -e

echo "Testing GitHub Copilot Integration"

echo "Building CLI..."
pnpm run build >/dev/null 2>&1

# Test 1: Command registration (dist commands export)
echo "Test 1: Verifying copilot-login command is registered"
node --input-type=module -e "
  import {copilotLoginCommand} from './dist/commands/index.js';
  if (copilotLoginCommand && copilotLoginCommand.name === 'copilot-login') {
    console.log('✓ copilot-login command registered');
  } else {
    console.log('✗ copilot-login command not found in dist/commands');
    process.exit(1);
  }
" || exit 1

# Test 2: Provider template exists (dist provider templates)
echo "Test 2: Verifying GitHub Copilot provider template"
node --input-type=module -e "
  import {PROVIDER_TEMPLATES} from './dist/wizards/templates/provider-templates.js';
  const hasCopilot = PROVIDER_TEMPLATES.some(t => t.name === 'GitHub Copilot');
  if (hasCopilot) {
    console.log('✓ GitHub Copilot provider template available');
  } else {
    console.log('✗ GitHub Copilot provider template not found in dist templates');
    process.exit(1);
  }
" || exit 1

# Test 3: Credential storage functions
echo "Test 3: Testing credential storage functions"
# Create a temporary config directory
TEMP_CONFIG=$(mktemp -d)
export XDG_CONFIG_HOME="$TEMP_CONFIG"

# Test saving and loading credential
echo "Testing credential save/load..."
node --input-type=module -e "
  import {saveCopilotCredential, loadCopilotCredential} from './dist/config/copilot-credentials.js';
  saveCopilotCredential('GitHub Copilot', 'test-token-123');
  const cred = loadCopilotCredential('GitHub Copilot');
  if (cred && cred.refreshToken === 'test-token-123') {
    console.log('✓ Credential storage works correctly');
  } else {
    console.log('✗ Credential storage failed');
    process.exit(1);
  }
" || exit 1

# Cleanup
rm -rf "$TEMP_CONFIG"

echo "All GitHub Copilot integration tests passed!"