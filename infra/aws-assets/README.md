# aws-assets

AWS CDK (TypeScript) app with one stack, `RenovixAssetsDev`, that creates one private S3 bucket for Renovix AI assets:

- name `renovix-ai-assets-dev` (bucket names are global; if it is taken the deploy fails, pick another name in `lib/assets-stack.ts`)
- all four Block Public Access settings on, ACLs disabled (`BucketOwnerEnforced`), SSE-S3 encryption
- SSL enforced: a bucket-policy Deny on `aws:SecureTransport = false`, the only statement in the policy
- `RETAIN` on delete and replace
- outputs: `BucketName` and `BucketArn`

Separate from the Terraform in `infra/`. No account id or region is in the code: the CDK CLI reads them from the active AWS profile.

## Prerequisites

- Node 22 or newer, npm
- AWS CLI with a profile that can deploy CloudFormation and S3. The default profile has region `ap-southeast-1` (a hint only). Use another profile with `--profile <name>`; set the region with `AWS_REGION=<region>` or in the profile.

## Commands, in order

Run everything in `infra/aws-assets`.

```sh
npm install
npm test                  # tests on the synthesized template, no AWS calls
npm run scan              # greps this folder for AWS keys and account ids
npx cdk synth             # works without AWS credentials
```

One-time, only if the account/region was never bootstrapped. Check first: the CloudFormation stack `CDKToolkit` must exist.

```sh
aws cloudformation describe-stacks --stack-name CDKToolkit --query 'Stacks[0].StackStatus' --output text
npx cdk bootstrap aws://<account>/<region>
```

Then:

```sh
npx cdk diff
npx cdk deploy
```

Add `--profile <name>` to the `cdk` and `aws` commands if you do not use the default profile. A CDK app deploys to one account/region: the one of the active profile.

Read the outputs after the deploy:

```sh
aws cloudformation describe-stacks --stack-name RenovixAssetsDev --query 'Stacks[0].Outputs'
```

Check the bucket:

```sh
aws s3api get-public-access-block --bucket renovix-ai-assets-dev
aws s3api get-bucket-encryption --bucket renovix-ai-assets-dev
aws s3api get-bucket-policy --bucket renovix-ai-assets-dev
aws s3 ls s3://renovix-ai-assets-dev
```

## Destroy

The bucket is `RETAIN`. `npx cdk destroy` removes the stack but keeps the bucket and its objects. To remove it, empty and delete the bucket by hand afterwards.

## Open questions

- Which account/region or profile is the target for dev (and later prod)?
- CDN: is CloudFront in front of the bucket needed (`S3_CDN_DOMAIN`)? Not added.
- Browser uploads with presigned URLs from the chat app need CORS on the bucket. Not added.
- Lifecycle/expiry rules and versioning for dev objects? Not added.
- How does the API get credentials: IAM user with keys, or a role (RX-165)? No IAM is created here.
- Bucket name for prod? Names are global, so `renovix-ai-assets-dev` may also be taken.
