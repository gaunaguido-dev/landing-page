#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SiteStack } from '../lib/site-stack';
import { ApiStack  } from '../lib/api-stack';

const app = new cdk.App();

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region:  process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

// Config — override defaults with CDK context flags:
//   cdk deploy --context fromEmail=other@domain.com
const fromEmail = app.node.tryGetContext('fromEmail') ?? 'hola@g2techwork.com';
const toEmail   = app.node.tryGetContext('toEmail')   ?? 'hola@g2techwork.com';

// ── Stacks ──────────────────────────────────────────────────────────────────

const siteStack = new SiteStack(app, 'G2TechworkSite', { env });

new ApiStack(app, 'G2TechworkApi', {
  env,
  fromEmail,
  toEmail,
  // Pass the CF domain as allowed CORS origin.
  // CDK resolves this cross-stack reference at deploy time —
  // SiteStack is guaranteed to deploy before ApiStack.
  allowedOrigin: `https://${siteStack.distribution.distributionDomainName}`,
});

app.synth();
