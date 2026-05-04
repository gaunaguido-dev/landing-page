#!/usr/bin/env bash
# Build the send-email Lambda bundle.
# Must be run before `terraform apply` if the null_resource auto-build is disabled.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAMBDA_DIR="$SCRIPT_DIR/../lambdas/send-email"

echo "→ Installing Lambda dependencies..."
cd "$LAMBDA_DIR"
npm ci --silent

echo "→ Bundling with esbuild..."
npm run build

echo "✓ Lambda built → $LAMBDA_DIR/dist/index.js"
