# ── Origin Access Control ─────────────────────────────────────────────────────

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.project_name}-${var.environment}-oac"
  description                       = "OAC for ${var.project_name} S3 static site"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ── Cache policies ─────────────────────────────────────────────────────────────

# Short TTL for HTML — ensures users always get fresh content
resource "aws_cloudfront_cache_policy" "html" {
  name        = "${var.project_name}-${var.environment}-html"
  comment     = "Short TTL for HTML files"
  default_ttl = 60
  max_ttl     = 300
  min_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config       { cookie_behavior       = "none" }
    headers_config       { header_behavior       = "none" }
    query_strings_config { query_string_behavior = "none" }
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
  }
}

# ── CloudFront Function: URL rewrite ──────────────────────────────────────────
# Rewrites extensionless paths (e.g. /about) to their index.html equivalent.
# Required for Astro static output where pages become /about/index.html.

resource "aws_cloudfront_function" "url_rewrite" {
  name    = "${var.project_name}-${var.environment}-url-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "Rewrite directory URLs to /index.html"
  publish = true

  code = <<-JS
    async function handler(event) {
      const req = event.request;
      const uri = req.uri;
      if (uri.endsWith('/')) {
        req.uri = uri + 'index.html';
      } else if (!uri.includes('.')) {
        req.uri = uri + '/index.html';
      }
      return req;
    }
  JS
}

# ── CloudFront Distribution ────────────────────────────────────────────────────

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_All"
  http_version        = "http2and3"
  comment             = "${var.project_name} ${var.environment} landing page"

  aliases = local.use_custom_domain ? [var.domain_name, "www.${var.domain_name}"] : []

  # S3 origin — served through OAC (no public bucket access)
  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "S3-${aws_s3_bucket.site.bucket}"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  # Default cache behaviour: long-lived, compressed, immutable assets
  default_cache_behavior {
    target_origin_id       = "S3-${aws_s3_bucket.site.bucket}"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # AWS managed CachingOptimized policy
    cache_policy_id          = "658327ea-f89d-4fab-a63d-7e88639e58f6"
    # AWS managed CORS-S3Origin origin request policy
    origin_request_policy_id = "88a5eaf4-2fd4-4709-b370-b4c650ea3fcf"

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.url_rewrite.arn
    }
  }

  # HTML files — short cache so content updates propagate quickly
  ordered_cache_behavior {
    path_pattern           = "*.html"
    target_origin_id       = "S3-${aws_s3_bucket.site.bucket}"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = aws_cloudfront_cache_policy.html.id
  }

  # 403/404 → serve index.html so client-side routing works
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  custom_error_response {
    error_code            = 404
    response_code         = 404
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = !local.use_custom_domain
    acm_certificate_arn            = local.use_custom_domain ? aws_acm_certificate_validation.site[0].certificate_arn : null
    ssl_support_method             = local.use_custom_domain ? "sni-only" : null
    minimum_protocol_version       = local.use_custom_domain ? "TLSv1.2_2021" : "TLSv1"
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-cdn"
  }
}
