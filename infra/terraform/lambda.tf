# ── Build the Lambda bundle ────────────────────────────────────────────────────
# Rebuilds whenever TypeScript source or package.json changes.
# Requires bash (Git Bash / WSL on Windows, native on macOS/Linux).

resource "null_resource" "lambda_build" {
  triggers = {
    src_hash = sha256(join("", [
      for f in fileset("${path.module}/../../lambdas/send-email/src", "**") :
      filesha256("${path.module}/../../lambdas/send-email/src/${f}")
    ]))
    pkg_hash = filesha256("${path.module}/../../lambdas/send-email/package.json")
  }

  provisioner "local-exec" {
    working_dir = "${path.module}/../../lambdas/send-email"
    command     = "npm ci --silent && npm run build"
    interpreter = ["bash", "-c"]
  }
}

# Package the built output into a ZIP file
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_file = "${path.module}/../../lambdas/send-email/dist/index.js"
  output_path = "${path.module}/.build/send-email.zip"

  depends_on = [null_resource.lambda_build]
}

# ── Lambda function ────────────────────────────────────────────────────────────

resource "aws_lambda_function" "send_email" {
  function_name = "${var.project_name}-${var.environment}-send-email"
  description   = "Handles contact-form submissions and sends emails via Resend"

  role             = aws_iam_role.lambda.arn
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  handler       = "index.handler"
  runtime       = "nodejs20.x"
  architectures = ["arm64"]      # arm64 is faster and ~20% cheaper for Node.js

  memory_size = var.lambda_memory_mb
  timeout     = var.lambda_timeout_s

  environment {
    variables = {
      RESEND_API_KEY_PARAM = aws_ssm_parameter.resend_api_key.name
      FROM_EMAIL           = var.from_email
      TO_EMAIL             = var.to_email
      # ALLOWED_ORIGIN is resolved after CloudFront is created
      ALLOWED_ORIGIN = local.use_custom_domain
        ? "https://${var.domain_name}"
        : "https://${aws_cloudfront_distribution.site.domain_name}"
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic_execution,
    aws_cloudwatch_log_group.lambda,
  ]
}

# ── CloudWatch log group ───────────────────────────────────────────────────────
# Create explicitly so retention is enforced. Without this, Lambda auto-creates
# a log group with infinite retention.

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.project_name}-${var.environment}-send-email"
  retention_in_days = var.lambda_log_retention_days
}
