#!/usr/bin/env bash
# Invalidate the CloudFront distribution cache without a full deploy.
set -euo pipefail

TF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../terraform" && pwd)"

echo "→ Reading Terraform outputs..."
cd "$TF_DIR"
CF_DIST_ID=$(terraform output -raw cloudfront_distribution_id)

echo "→ Creating invalidation for distribution $CF_DIST_ID..."
INVALIDATION_ID=$(aws cloudfront create-invalidation \
  --distribution-id "$CF_DIST_ID" \
  --paths "/*" \
  --query 'Invalidation.Id' \
  --output text)

echo "✓ Invalidation created: $INVALIDATION_ID"
echo "  (takes ~60 seconds to propagate globally)"
