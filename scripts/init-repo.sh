#!/bin/bash
# KeePic — Initialize git repo and create private GitHub repository
# Run WITHOUT sudo, AFTER: sudo bash scripts/setup-gh.sh && gh auth login

set -e

REPO_NAME="keepic"
REPO_DIR="/home/mathi/keepic"

cd "$REPO_DIR"

echo "==> Initializing local git repository..."
git init
git branch -M main

echo "==> Creating .gitignore..."
cat > .gitignore << 'EOF'
# Dependencies
node_modules/
target/

# Build outputs
dist/
out/
build/
.vite/

# OS
.DS_Store
Thumbs.db

# Editor
.vscode/
.idea/
*.swp
*.swo

# Environment
.env
.env.local
.env.*.local

# Logs
*.log
npm-debug.log*

# KeePic library data (never commit user photos or DB)
library/
*.db
*.db-shm
*.db-wal

# Thumbnails cache
.keepic/
EOF

echo "==> Creating initial commit..."
git add .
git commit -m "Initial commit: project documentation structure

- CLAUDE.md: session instructions and documentation index
- docs/specs/specifications.md: functional and non-functional specs (v0.1)
- docs/architecture/architecture.md: architecture overview and data flows
- docs/architecture/adr/: ADR-000 template, ADR-001 (framework), ADR-002 (storage), ADR-003 (Google Photos)
- docs/tasks/backlog.md: 21 tasks across 4 phases
- docs/sessions/2026-02-21-session-001.md: first session report

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"

echo "==> Creating private GitHub repository '$REPO_NAME'..."
gh repo create "$REPO_NAME" \
  --private \
  --description "Personal photo library manager — import, deduplicate and organize photos locally" \
  --source=. \
  --remote=origin \
  --push

echo ""
echo "==> Done! Repository available at:"
gh repo view --json url -q .url
