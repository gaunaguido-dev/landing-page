# ACM certificates for CloudFront MUST be in us-east-1 regardless of the
# primary region. They are created with the `aws.us_east_1` provider alias.

resource "aws_acm_certificate" "site" {
  count    = local.use_custom_domain ? 1 : 0
  provider = aws.us_east_1

  domain_name               = var.domain_name
  subject_alternative_names = ["*.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# ── Route 53 validation records (only when hosted_zone_id is provided) ────────

resource "aws_route53_record" "cert_validation" {
  for_each = local.use_route53 ? {
    for dvo in aws_acm_certificate.site[0].domain_validation_options :
    dvo.domain_name => dvo
  } : {}

  zone_id = var.hosted_zone_id
  name    = each.value.resource_record_name
  type    = each.value.resource_record_type
  ttl     = 60
  records = [each.value.resource_record_value]

  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "site" {
  count    = local.use_custom_domain ? 1 : 0
  provider = aws.us_east_1

  certificate_arn = aws_acm_certificate.site[0].arn

  # When Route 53 manages DNS, wait for the records to be created first
  validation_record_fqdns = local.use_route53 ? [
    for r in aws_route53_record.cert_validation : r.fqdn
  ] : []
}

# ── Route 53 A/AAAA records pointing to CloudFront ────────────────────────────

resource "aws_route53_record" "apex" {
  count   = local.use_route53 ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www" {
  count   = local.use_route53 ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = "www.${var.domain_name}"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}
