# HTTP API (v2) — simpler and cheaper than REST API for a single Lambda route.

resource "aws_apigatewayv2_api" "api" {
  name          = "${var.project_name}-${var.environment}-api"
  protocol_type = "HTTP"
  description   = "${var.project_name} contact-form API"

  cors_configuration {
    allow_headers  = ["content-type"]
    allow_methods  = ["POST", "OPTIONS"]
    allow_origins  = local.use_custom_domain ? ["https://${var.domain_name}"] : ["*"]
    expose_headers = []
    max_age        = 300
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gw.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      responseLength = "$context.responseLength"
      integrationError = "$context.integrationErrorMessage"
    })
  }

  default_route_settings {
    throttling_burst_limit = 50   # max concurrent requests
    throttling_rate_limit  = 20   # requests/second sustained
  }
}

# ── Lambda integration ────────────────────────────────────────────────────────

resource "aws_apigatewayv2_integration" "send_email" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.send_email.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "post_contact" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /contact"
  target    = "integrations/${aws_apigatewayv2_integration.send_email.id}"
}

# Allow API Gateway to invoke the Lambda
resource "aws_lambda_permission" "api_gw_invoke" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.send_email.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# ── CloudWatch log group ───────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "api_gw" {
  name              = "/aws/apigateway/${var.project_name}-${var.environment}"
  retention_in_days = var.lambda_log_retention_days
}

# IAM policy so API Gateway can write to CloudWatch
resource "aws_iam_role" "api_gw_cloudwatch" {
  name = "${var.project_name}-${var.environment}-apigw-cw-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "apigateway.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "api_gw_cloudwatch" {
  role       = aws_iam_role.api_gw_cloudwatch.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"
}

resource "aws_api_gateway_account" "main" {
  cloudwatch_role_arn = aws_iam_role.api_gw_cloudwatch.arn
}
