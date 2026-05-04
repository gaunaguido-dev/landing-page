#!/usr/bin/env bash
# Full deploy: build Astro → sync to S3 → invalidate CloudFront.
# Run AFTER `terraform apply` so the outputs are available.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$SCRIPT_DIR/../terraform"
PROJECT_DIR="$SCRIPT_DIR/../.."

# ── Read Terraform outputs ────────────────────────────────────────────────────
echo "→ Reading Terraform outputs..."
cd "$TF_DIR"

S3_BUCKET=$(terraform output -raw s3_bucket_name)
CF_DIST_ID=$(terraform output -raw cloudfront_distribution_id)
API_ENDPOINT=$(terraform output -raw api_endpoint)
SITE_URL=$(terraform output -raw site_url)

echo "   S3 bucket      : $S3_BUCKET"
echo "   CloudFront ID  : $CF_DIST_ID"
echo "   API endpoint   : $API_ENDPOINT"

# ── Build Astro ───────────────────────────────────────────────────────────────
echo ""
echo "→ Building Astro site..."
cd "$PROJECT_DIR"
PUBLIC_API_URL="$API_ENDPOINT" npm run build

# ── Sync to S3 (two passes for cache headers) ─────────────────────────────────
echo ""
echo "→ Uploading to S3 ($S3_BUCKET)..."

# Static assets: 1-year immutable cache
aws s3 sync dist/ "s3://$S3_BUCKET/" \
  --delete \
  --cache-control "public, max-age=31536000, immutable" \
  --exclude "*.html" \
  --exclude "*.xml"  \
  --exclude "*.txt"  \
  --exclude "*.json"

# HTML + text files: no cache so users always fetch fresh markup
aws s3 sync dist/ "s3://$S3_BUCKET/" \
  --exclude "*" \
  --include "*.html" \
  --include "*.xml"  \
  --include "*.txt"  \
  --include "*.json" \
  --cache-control "public, max-age=0, must-revalidate"

# ── Invalidate CloudFront ──────────────────────────────────────────────────────
echo ""
echo "→ Invalidating CloudFront cache ($CF_DIST_ID)..."
INVALIDATION_ID=$(aws cloudfront create-invalidation \
  --distribution-id "$CF_DIST_ID" \
  --paths "/*" \
  --query 'Invalidation.Id' \
  --output text)
echo "   Invalidation ID: $INVALIDATION_ID"

echo ""
echo "✅ Deploy complete!"
echo "   $SITE_URL"
