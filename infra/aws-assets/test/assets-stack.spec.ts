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
    expect(Object.keys(template.toJSON().Outputs)).toEqual(['BucketName', 'BucketArn', 'AssetsApiUserName', 'AssetsApiPolicyArn']);
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

type Statement = Record<string, unknown>;
type PolicyDocument = { Statement: Statement[] };

const API_USER_NAME = 'renovix-ai-assets-dev-api';
const EXPECTED_OUTPUTS = ['AssetsApiPolicyArn', 'AssetsApiUserName', 'BucketArn', 'BucketName'];

/** Logical ids of all resources of the given type. */
function findLogicalIds(type: string): string[] {
  return Object.keys(resources).filter((logicalId) => resources[logicalId].Type === type);
}

/** Returns a value that may be a single item or a list as a list. */
function toList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

/** Every IAM policy document in the template: managed, inline (Policy) and inline on users, groups and roles. */
function collectIamPolicyDocuments(): PolicyDocument[] {
  return Object.values(resources).flatMap((resource) => {
    const properties = resource.Properties ?? {};
    if (resource.Type === 'AWS::IAM::ManagedPolicy' || resource.Type === 'AWS::IAM::Policy') {
      return [properties.PolicyDocument as PolicyDocument];
    }
    if (['AWS::IAM::User', 'AWS::IAM::Group', 'AWS::IAM::Role'].includes(resource.Type)) {
      const inline = (properties.Policies ?? []) as { PolicyDocument: PolicyDocument }[];
      return inline.map((entry) => entry.PolicyDocument);
    }
    return [];
  });
}

const bucketId = findLogicalIds('AWS::S3::Bucket')[0];
const policyIds = findLogicalIds('AWS::IAM::ManagedPolicy');
const userIds = findLogicalIds('AWS::IAM::User');
const policyStatements = (resources[policyIds[0]]?.Properties?.PolicyDocument as PolicyDocument | undefined)?.Statement ?? [];
const bucketArn = { 'Fn::GetAtt': [bucketId, 'Arn'] };

describe('AssetsStack API user (RX-176)', () => {
  it('a. has exactly one managed policy with exactly two Allow statements', () => {
    template.resourceCountIs('AWS::IAM::ManagedPolicy', 1);
    expect(policyStatements).toHaveLength(2);
    expect(policyStatements.map((statement) => statement.Effect)).toEqual(['Allow', 'Allow']);
  });

  it('b. object statement allows exactly Put/Get/DeleteObject on the bucket ARN joined with "/*"', () => {
    const objectStatement = policyStatements.find((statement) => toList(statement.Action).includes('s3:PutObject'));
    expect([...toList(objectStatement?.Action)].sort()).toEqual(['s3:DeleteObject', 's3:GetObject', 's3:PutObject']);
    expect(toList(objectStatement?.Resource)).toEqual([{ 'Fn::Join': ['', [bucketArn, '/*']] }]);
  });

  it('c. bucket statement allows exactly s3:ListBucket on the bucket ARN', () => {
    const bucketStatement = policyStatements.find((statement) => !toList(statement.Action).includes('s3:PutObject'));
    expect(toList(bucketStatement?.Action)).toEqual(['s3:ListBucket']);
    expect(toList(bucketStatement?.Resource)).toEqual([bucketArn]);
  });

  it('d. no IAM policy document has a wildcard action, a "*" resource, NotAction or NotResource', () => {
    const statements = collectIamPolicyDocuments().flatMap((document) => document.Statement);
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(toList(statement.Action).filter((action) => String(action).includes('*'))).toEqual([]);
      expect(toList(statement.Resource).filter((resource) => resource === '*' || resource === 'arn:aws:s3:::*')).toEqual([]);
      expect(statement).not.toHaveProperty('NotAction');
      expect(statement).not.toHaveProperty('NotResource');
    }
  });

  it('e. has exactly one IAM user, renovix-ai-assets-dev-api, whose only policy is the managed policy, with no login profile, inline policies or groups', () => {
    expect(userIds).toHaveLength(1);
    const userProperties = resources[userIds[0]].Properties ?? {};
    expect(userProperties.UserName).toBe(API_USER_NAME);
    expect(userProperties.ManagedPolicyArns).toEqual([{ Ref: policyIds[0] }]);
    expect(userProperties).not.toHaveProperty('LoginProfile');
    expect(userProperties).not.toHaveProperty('Policies');
    expect(userProperties).not.toHaveProperty('Groups');
    template.resourcePropertiesCountIs('AWS::IAM::ManagedPolicy', { Users: Match.anyValue() }, 0);
  });

  it('f. creates no access key, secret, SSM parameter, inline IAM policy or role', () => {
    template.resourceCountIs('AWS::IAM::AccessKey', 0);
    template.resourceCountIs('AWS::SecretsManager::Secret', 0);
    template.resourceCountIs('AWS::SSM::Parameter', 0);
    template.resourceCountIs('AWS::IAM::Policy', 0);
    template.resourceCountIs('AWS::IAM::Role', 0);
  });

  it('g. outputs exactly the bucket name, bucket ARN, user name and policy ARN, none carrying an access key', () => {
    const outputs = template.toJSON().Outputs as Record<string, unknown>;
    expect(Object.keys(outputs).sort()).toEqual(EXPECTED_OUTPUTS);
    template.hasOutput('AssetsApiUserName', { Value: { Ref: userIds[0] } });
    template.hasOutput('AssetsApiPolicyArn', { Value: { Ref: policyIds[0] } });
    expect(JSON.stringify(outputs)).not.toMatch(/AccessKey|SecretAccessKey/i);
  });

  it('h. the bucket policy is still only the enforce-SSL Deny', () => {
    const bucketPolicy = Object.values(resources).filter((resource) => resource.Type === 'AWS::S3::BucketPolicy');
    expect(bucketPolicy).toHaveLength(1);
    const statements = (bucketPolicy[0].Properties?.PolicyDocument as PolicyDocument).Statement;
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } });
  });
});
