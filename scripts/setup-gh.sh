#!/bin/bash
# KeePic — Install GitHub CLI (gh)
# Run with: sudo bash scripts/setup-gh.sh

set -e

echo "==> Installing GitHub CLI..."
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | tee /etc/apt/sources.list.d/github-cli.list > /dev/null
apt update -qq
apt install gh -y

echo ""
echo "==> gh installed successfully: $(gh --version | head -1)"
echo ""
echo "Next steps (run WITHOUT sudo):"
echo "  1. gh auth login        # Authenticate with your GitHub account"
echo "  2. bash scripts/init-repo.sh  # Initialize git and create the repo"
