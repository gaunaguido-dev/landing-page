variable "project_name" {
  description = "Project name — used as a prefix for all resource names."
  type        = string
  default     = "g2techwork"
}

variable "environment" {
  description = "Deployment environment: prod | staging | dev"
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["prod", "staging", "dev"], var.environment)
    error_message = "environment must be one of: prod, staging, dev."
  }
}

variable "aws_region" {
  description = "AWS region for Lambda, API Gateway, S3, and SSM."
  type        = string
  default     = "us-east-1"
}

# ── Domain (optional) ────────────────────────────────────────────────────────

variable "domain_name" {
  description = <<-EOT
    Custom domain for the CloudFront distribution, e.g. "g2techwork.com".
    Leave empty ("") to use the auto-generated *.cloudfront.net domain.
    When set, an ACM certificate is provisioned and DNS records are expected
    to be validated externally (see acm.tf for the CNAME values to create).
  EOT
  type    = string
  default = ""
}

variable "hosted_zone_id" {
  description = <<-EOT
    Route 53 Hosted Zone ID for `domain_name`. Only required when
    `domain_name` is set AND you want Terraform to manage DNS records.
    Leave empty to manage DNS manually.
  EOT
  type    = string
  default = ""
}

# ── Email ─────────────────────────────────────────────────────────────────────

variable "resend_api_key" {
  description = "Resend API key — stored as a SecureString in SSM Parameter Store."
  type        = string
  sensitive   = true
}

variable "from_email" {
  description = "Verified sender address for outgoing emails (must be verified in Resend)."
  type        = string
  default     = "hola@g2techwork.com"
}

variable "to_email" {
  description = "Inbox that receives contact-form notifications."
  type        = string
  default     = "hola@g2techwork.com"
}

# ── Lambda ────────────────────────────────────────────────────────────────────

variable "lambda_memory_mb" {
  description = "Lambda memory allocation in MB."
  type        = number
  default     = 256
}

variable "lambda_timeout_s" {
  description = "Lambda execution timeout in seconds."
  type        = number
  default     = 15
}

variable "lambda_log_retention_days" {
  description = "CloudWatch log retention in days for the Lambda function."
  type        = number
  default     = 14
}
