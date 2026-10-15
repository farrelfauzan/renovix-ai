import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AssetsStack } from '../lib/assets-stack';

type Resource = { Type: string; Properties?: Record<string, unknown> };

const template = Template.fromStack(
  new AssetsStack(new App(), 'TestStack'),
);
const resources = template.toJSON().Resources as Record<string, Resource>;
const types = Object.values(resources).map((resource) => resource.Type);

describe('AssetsStack', () => {
  it('creates exactly one bucket with the expected name', () => {
    template.resourceCountIs('AWS::S3::Bucket', 1);
    template.hasResourceProperties('AWS::S3::Bucket', { BucketName: 'renovix-ai-assets-dev' });
  });

  it('blocks all public access', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('encrypts with SSE-S3', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
    });
  });

  it('retains the bucket on delete and replace', () => {
    template.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  it('outputs the bucket name and ARN', () => {
    template.hasOutput('BucketName', { Value: { Ref: Match.stringLikeRegexp('^AssetsBucket') } });
    template.hasOutput('BucketArn', { Value: { 'Fn::GetAtt': [Match.stringLikeRegexp('^AssetsBucket'), 'Arn'] } });
    expect(Object.keys(template.toJSON().Outputs)).toEqual(['BucketName', 'BucketArn']);
  });

  it('has ACLs disabled: ownership is BucketOwnerEnforced', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
    });
  });

  it('has no ACL on the bucket (no public ACL)', () => {
    template.resourcePropertiesCountIs('AWS::S3::Bucket', { AccessControl: Match.anyValue() }, 0);
  });

  it('has no website, CORS or lifecycle configuration', () => {
    template.resourcePropertiesCountIs('AWS::S3::Bucket', { WebsiteConfiguration: Match.anyValue() }, 0);
    template.resourcePropertiesCountIs('AWS::S3::Bucket', { CorsConfiguration: Match.anyValue() }, 0);
    template.resourcePropertiesCountIs('AWS::S3::Bucket', { LifecycleConfiguration: Match.anyValue() }, 0);
  });

  it('has no CloudFront resources', () => {
    expect(types.filter((type) => type.startsWith('AWS::CloudFront::'))).toEqual([]);
  });

  it('has no policy statement allowing Principal "*"', () => {
    template.resourcePropertiesCountIs(
      'AWS::S3::BucketPolicy',
      { PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Effect: 'Allow', Principal: '*' })]) } },
      0,
    );
    template.resourcePropertiesCountIs(
      'AWS::S3::BucketPolicy',
      { PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Effect: 'Allow', Principal: { AWS: '*' } })]) } },
      0,
    );
  });

  it('has only the enforce-SSL Deny as bucket policy', () => {
    template.resourceCountIs('AWS::S3::BucketPolicy', 1);
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: [
          Match.objectLike({
            Effect: 'Deny',
            Action: 's3:*',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ],
      },
    });
  });
});
