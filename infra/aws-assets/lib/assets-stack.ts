import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { ManagedPolicy, PolicyStatement, User } from 'aws-cdk-lib/aws-iam';
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

const DEV_ASSET_EXPIRY_DAYS = 7;
const INCOMPLETE_UPLOAD_ABORT_DAYS = 1;

/** Private S3 bucket for Renovix AI assets (dev), plus the IAM user the API uses to reach it. */
export class AssetsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    const bucket = new Bucket(this, 'AssetsBucket', {
      bucketName: 'renovix-ai-assets-dev',
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          expiration: Duration.days(DEV_ASSET_EXPIRY_DAYS),
          abortIncompleteMultipartUploadAfter: Duration.days(INCOMPLETE_UPLOAD_ABORT_DAYS),
        },
      ],
    });
    const policy = new ManagedPolicy(this, 'AssetsApiPolicy', {
      statements: [
        new PolicyStatement({
          actions: ['s3:PutObject', 's3:GetObject', 's3:DeleteObject'],
          resources: [bucket.arnForObjects('*')],
        }),
        new PolicyStatement({
          actions: ['s3:ListBucket'],
          resources: [bucket.bucketArn],
        }),
      ],
    });
    const user = new User(this, 'AssetsApiUser', {
      userName: 'renovix-ai-assets-dev-api',
      managedPolicies: [policy],
    });
    new CfnOutput(this, 'BucketName', { value: bucket.bucketName });
    new CfnOutput(this, 'BucketArn', { value: bucket.bucketArn });
    new CfnOutput(this, 'AssetsApiUserName', { value: user.userName });
    new CfnOutput(this, 'AssetsApiPolicyArn', { value: policy.managedPolicyArn });
  }
}
