import * as path   from 'path';
import * as cdk    from 'aws-cdk-lib';
import * as iam    from 'aws-cdk-lib/aws-iam';
import * as logs   from 'aws-cdk-lib/aws-logs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigwv2      from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwInteg   from 'aws-cdk-lib/aws-apigatewayv2-integrations';
// CfnAccount is in aws-apigateway (shared account-level resource for v1 + v2)
import { CfnAccount as ApiGwCfnAccount } from 'aws-cdk-lib/aws-apigateway';
import * as ssm          from 'aws-cdk-lib/aws-ssm';
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
    // The parameter is created by the CI/CD pipeline (not by CDK) so the
    // plaintext value never touches CloudFormation.
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

    // ── Lambda — NodejsFunction auto-bundles via esbuild ───────────────────
    // Entry path is resolved relative to this source file at compile time.
    const lambdaRoot = path.join(__dirname, '../lambdas/send-email');

    const sendEmailFn = new lambdaNodejs.NodejsFunction(this, 'SendEmailFn', {
      functionName:   `${id}-send-email`,
      description:    'Handles contact-form submissions, sends emails via Resend',
      entry:          path.join(lambdaRoot, 'src/index.ts'),
      handler:        'handler',
      runtime:        lambda.Runtime.NODEJS_20_X,
      architecture:   lambda.Architecture.ARM_64,
      timeout:        cdk.Duration.seconds(15),
      memorySize:     256,
      logGroup,
      // projectRoot + depsLockFilePath must both point inside the lambda directory.
      // Without the explicit depsLockFilePath, CDK walks up and picks up
      // infra/package-lock.json, which fails the "must be under projectRoot" check.
      projectRoot:      lambdaRoot,
      depsLockFilePath: path.join(lambdaRoot, 'package-lock.json'),

      bundling: {
        // @aws-sdk/* is available in the Node 20 Lambda runtime — no need to bundle
        externalModules: ['@aws-sdk/*'],
        minify:          true,
        sourceMap:       false,
        target:          'node20',
        tsconfig:        path.join(lambdaRoot, 'tsconfig.json'),
      },

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

    // Enable access logging on the default stage
    const cfnStage = httpApi.defaultStage?.node.defaultChild as apigwv2.CfnStage;
    if (cfnStage) {
      cfnStage.accessLogSettings = {
        destinationArn: apiLogGroup.logGroupArn,
        format: JSON.stringify({
          requestId:       '$context.requestId',
          ip:              '$context.identity.sourceIp',
          requestTime:     '$context.requestTime',
          httpMethod:      '$context.httpMethod',
          routeKey:        '$context.routeKey',
          status:          '$context.status',
          responseLength:  '$context.responseLength',
          integrationError: '$context.integrationErrorMessage',
        }),
      };

      // Throttle the default stage
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
    // CfnAccount is an account-level singleton (shared across v1 and v2 APIs)
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
