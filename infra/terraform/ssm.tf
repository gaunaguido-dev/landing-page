# ── SSM Parameter Store ───────────────────────────────────────────────────────
# Secrets are kept in SSM so they are never embedded in Lambda env-vars in
# plaintext. The Lambda reads the value at cold-start and caches it.

resource "aws_ssm_parameter" "resend_api_key" {
  name        = "/${var.project_name}/resend_api_key"
  description = "Resend API key for the ${var.project_name} contact-form Lambda"
  type        = "SecureString"
  value       = var.resend_api_key

  # Prevent Terraform from overwriting a key that was rotated manually outside TF
  lifecycle {
    ignore_changes = [value]
  }
}
