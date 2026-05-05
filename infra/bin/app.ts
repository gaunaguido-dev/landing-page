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
const fromEmail = 'contact@g2techwork.com';
const toEmail   = process.env.TO_EMAIL ?? 'contact@g2techwork.com';

// ── Stacks ──────────────────────────────────────────────────────────────────

const siteStack = new SiteStack(app, 'G2TechworkSite', { env });

new ApiStack(app, 'G2TechworkApi', {
  env,
  fromEmail,
  toEmail,
  allowedOrigins: [
    'https://g2techwork.com',
    `https://${siteStack.distribution.distributionDomainName}`,
  ],
});

app.synth();
