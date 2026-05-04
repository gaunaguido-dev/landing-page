output "site_url" {
  description = "Public URL of the landing page."
  value       = local.use_custom_domain ? "https://${var.domain_name}" : "https://${aws_cloudfront_distribution.site.domain_name}"
}

output "cloudfront_domain" {
  description = "Raw CloudFront domain (*.cloudfront.net)."
  value       = aws_cloudfront_distribution.site.domain_name
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID — needed for cache invalidations."
  value       = aws_cloudfront_distribution.site.id
}

output "s3_bucket_name" {
  description = "S3 bucket that holds the static site files."
  value       = aws_s3_bucket.site.bucket
}

output "s3_bucket_arn" {
  description = "ARN of the S3 site bucket."
  value       = aws_s3_bucket.site.arn
}

output "api_endpoint" {
  description = "Contact-form API endpoint — set as PUBLIC_API_URL when building the Astro site."
  value       = "${aws_apigatewayv2_stage.default.invoke_url}/contact"
}

output "lambda_function_name" {
  description = "Name of the send-email Lambda function."
  value       = aws_lambda_function.send_email.function_name
}

output "ssm_resend_key_path" {
  description = "SSM path where the Resend API key is stored."
  value       = aws_ssm_parameter.resend_api_key.name
}

# Shown only when domain_name is set
output "acm_certificate_validation_cnames" {
  description = "DNS CNAME records required to validate the ACM certificate. Add these to your DNS provider."
  value = var.domain_name != "" ? {
    for dvo in aws_acm_certificate.site[0].domain_validation_options :
    dvo.domain_name => {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  } : {}
}
