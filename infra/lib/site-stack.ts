import * as cdk      from 'aws-cdk-lib';
import * as s3        from 'aws-cdk-lib/aws-s3';
import * as cf        from 'aws-cdk-lib/aws-cloudfront';
import * as origins   from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct }  from 'constructs';

export class SiteStack extends cdk.Stack {
  /** The S3 bucket holding static site files. */
  public readonly bucket: s3.Bucket;
  /** The CloudFront distribution serving the site. */
  public readonly distribution: cf.Distribution;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── S3 Bucket ──────────────────────────────────────────────────────────

    this.bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption:        s3.BucketEncryption.S3_MANAGED,
      versioned:         true,
      // RETAIN so an accidental `cdk destroy` doesn't nuke the site
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [{
        noncurrentVersionExpiration:        cdk.Duration.days(30),
        abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
      }],
    });

    // ── CloudFront Function — URL rewrite ──────────────────────────────────
    // Astro static output: /about → /about/index.html

    const urlRewriteFn = new cf.Function(this, 'UrlRewrite', {
      functionName: `${id}-url-rewrite`,
      runtime:      cf.FunctionRuntime.JS_2_0,
      comment:      'Rewrite extensionless paths to /index.html',
      code: cf.FunctionCode.fromInline(`
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
      `),
    });

    // ── Cache policy for HTML (short TTL) ──────────────────────────────────

    const htmlCachePolicy = new cf.CachePolicy(this, 'HtmlCache', {
      cachePolicyName:           `${id}-html`,
      defaultTtl:                cdk.Duration.seconds(60),
      maxTtl:                    cdk.Duration.seconds(300),
      minTtl:                    cdk.Duration.seconds(0),
      enableAcceptEncodingGzip:  true,
      enableAcceptEncodingBrotli: true,
      headerBehavior:      cf.CacheHeaderBehavior.none(),
      cookieBehavior:      cf.CacheCookieBehavior.none(),
      queryStringBehavior: cf.CacheQueryStringBehavior.none(),
    });

    // ── CloudFront Distribution ────────────────────────────────────────────

    // OAC origin — S3 bucket is never exposed publicly.
    // CDK automatically creates the OAC resource and the bucket policy.
    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(this.bucket);

    this.distribution = new cf.Distribution(this, 'Distribution', {
      comment:            `${id} landing page`,
      defaultRootObject:  'index.html',
      httpVersion:        cf.HttpVersion.HTTP2_AND_3,
      priceClass:         cf.PriceClass.PRICE_CLASS_ALL,

      defaultBehavior: {
        origin:                s3Origin,
        viewerProtocolPolicy:  cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress:              true,
        // AWS managed CachingOptimized — long TTL for versioned assets
        cachePolicy:           cf.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [{
          function:  urlRewriteFn,
          eventType: cf.FunctionEventType.VIEWER_REQUEST,
        }],
      },

      additionalBehaviors: {
        // HTML files get a short cache so content updates propagate quickly
        '*.html': {
          origin:               s3Origin,
          viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          compress:             true,
          cachePolicy:          htmlCachePolicy,
        },
      },

      errorResponses: [
        // S3 returns 403 for missing keys — remap to 200 + index.html
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.seconds(10) },
        { httpStatus: 404, responseHttpStatus: 404, responsePagePath: '/index.html', ttl: cdk.Duration.seconds(10) },
      ],
    });

    // ── Outputs ────────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, 'BucketName', {
      value:       this.bucket.bucketName,
      description: 'S3 bucket for static site files',
      exportName:  `${id}-BucketName`,
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value:       this.distribution.distributionId,
      description: 'CloudFront distribution ID (needed for cache invalidation)',
      exportName:  `${id}-DistributionId`,
    });

    new cdk.CfnOutput(this, 'SiteUrl', {
      value:       `https://${this.distribution.distributionDomainName}`,
      description: 'Public URL of the landing page',
      exportName:  `${id}-SiteUrl`,
    });
  }
}
