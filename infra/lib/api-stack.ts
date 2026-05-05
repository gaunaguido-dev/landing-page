import * as path   from 'path';
import * as cdk    from 'aws-cdk-lib';
import * as iam    from 'aws-cdk-lib/aws-iam';
import * as logs   from 'aws-cdk-lib/aws-logs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2    from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwInteg from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { CfnAccount as ApiGwCfnAccount } from 'aws-cdk-lib/aws-apigateway';
import * as ssm     from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface ApiStackProps extends cdk.StackProps {
  fromEmail:     string;
  toEmail:       string;
  /** Injected as ALLOWED_ORIGIN env var in the Lambda (CORS). */
  allowedOrigin: string;
}

export class ApiStack extends cdk.Stack {
  /** Full URL of the POST /contact endpoint. */
  public readonly apiEndpoint: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // ── SSM — reference the pre-existing SecureString ──────────────────────
    // The parameter is written by CI (aws ssm put-parameter) so the value
    // never appears in any CloudFormation template.
    const resendKeyParam = ssm.StringParameter.fromSecureStringParameterAttributes(
      this, 'ResendApiKeyParam',
      { parameterName: '/g2techwork/resend_api_key' },
    );

    // ── Lambda log group (explicit = controlled retention) ─────────────────
    const logGroup = new logs.LogGroup(this, 'SendEmailLogs', {
      logGroupName:  `/aws/lambda/${id}-send-email`,
      retention:     logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── Lambda function ────────────────────────────────────────────────────
    // We use lambda.Function + Code.fromAsset instead of NodejsFunction to
    // avoid CDK's depsLockFilePath auto-detection walking up past the lambda
    // directory and picking up infra/package-lock.json.
    //
    // The bundle (dist/index.js) is produced by esbuild in CI BEFORE this
    // stack is synthesised — see the "Build Lambda" step in deploy.yml.
    // Locally: cd infra/lambdas/send-email && npm ci && npm run build
    const lambdaDist = path.join(__dirname, '../lambdas/send-email/dist');

    const sendEmailFn = new lambda.Function(this, 'SendEmailFn', {
      functionName:  `${id}-send-email`,
      description:   'Handles contact-form submissions, sends emails via Resend',
      code:          lambda.Code.fromAsset(lambdaDist),
      handler:       'index.handler',
      runtime:       lambda.Runtime.NODEJS_20_X,
      architecture:  lambda.Architecture.ARM_64,
      timeout:       cdk.Duration.seconds(15),
      memorySize:    256,
      logGroup,
      environment: {
        RESEND_API_KEY_PARAM: resendKeyParam.parameterName,
        FROM_EMAIL:           props.fromEmail,
        TO_EMAIL:             props.toEmail,
        ALLOWED_ORIGIN:       props.allowedOrigin,
      },
    });

    // Grant Lambda permission to read the SSM SecureString
    resendKeyParam.grantRead(sendEmailFn);

    // ── HTTP API (v2) ──────────────────────────────────────────────────────

    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName:     `${id}-api`,
      description: 'g2techwork contact-form API',
      corsPreflight: {
        allowHeaders:  ['Content-Type'],
        allowMethods:  [apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
        allowOrigins:  [props.allowedOrigin],
        maxAge:        cdk.Duration.seconds(300),
      },
    });

    // POST /contact → Lambda
    httpApi.addRoutes({
      path:        '/contact',
      methods:     [apigwv2.HttpMethod.POST],
      integration: new apigwInteg.HttpLambdaIntegration('ContactIntegration', sendEmailFn, {
        payloadFormatVersion: apigwv2.PayloadFormatVersion.VERSION_2_0,
      }),
    });

    // ── API Gateway access logs ────────────────────────────────────────────

    const apiLogGroup = new logs.LogGroup(this, 'ApiGwLogs', {
      logGroupName:  `/aws/apigateway/${id}`,
      retention:     logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const cfnStage = httpApi.defaultStage?.node.defaultChild as apigwv2.CfnStage;
    if (cfnStage) {
      cfnStage.accessLogSettings = {
        destinationArn: apiLogGroup.logGroupArn,
        format: JSON.stringify({
          requestId:        '$context.requestId',
          ip:               '$context.identity.sourceIp',
          requestTime:      '$context.requestTime',
          httpMethod:       '$context.httpMethod',
          routeKey:         '$context.routeKey',
          status:           '$context.status',
          responseLength:   '$context.responseLength',
          integrationError: '$context.integrationErrorMessage',
        }),
      };
      cfnStage.defaultRouteSettings = {
        throttlingBurstLimit: 50,
        throttlingRateLimit:  20,
      };
    }

    // Allow API Gateway to write to CloudWatch
    const apiGwRole = new iam.Role(this, 'ApiGwCloudWatchRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonAPIGatewayPushToCloudWatchLogs',
        ),
      ],
    });
    const cfnAccount = new ApiGwCfnAccount(this, 'ApiGwAccount', {
      cloudWatchRoleArn: apiGwRole.roleArn,
    });
    cfnAccount.node.addDependency(apiGwRole);

    // ── Outputs ────────────────────────────────────────────────────────────

    this.apiEndpoint = `${httpApi.apiEndpoint}/contact`;

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value:       this.apiEndpoint,
      description: 'Contact-form API endpoint — set as PUBLIC_API_URL when building the Astro site',
      exportName:  `${id}-ApiEndpoint`,
    });

    new cdk.CfnOutput(this, 'LambdaFunctionName', {
      value:      sendEmailFn.functionName,
      exportName: `${id}-LambdaName`,
    });
  }
}
