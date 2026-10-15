# aws-assets

AWS CDK (TypeScript) app with one stack, `RenovixAssetsDev`, that creates one private S3 bucket for Renovix AI assets and one IAM user for the API:

- name `renovix-ai-assets-dev` (bucket names are global; if it is taken the deploy fails, pick another name in `lib/assets-stack.ts`)
- all four Block Public Access settings on, ACLs disabled (`BucketOwnerEnforced`), SSE-S3 encryption
- SSL enforced: a bucket-policy Deny on `aws:SecureTransport = false`, the only statement in the policy
- `RETAIN` on delete and replace
- IAM user `renovix-ai-assets-dev-api` with one managed policy and nothing else: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on the bucket's objects and `s3:ListBucket` on the bucket. No console password, no group, no inline policy. The stack creates **no access key**: you create it by hand, see [API credentials (local/dev)](#api-credentials-localdev)
- outputs: `BucketName`, `BucketArn`, `AssetsApiUserName` and `AssetsApiPolicyArn`

Separate from the Terraform in `infra/`. No account id or region is in the code: the CDK CLI reads them from the active AWS profile.

## Prerequisites

- Node 22 or newer, npm
- AWS CLI with a profile that can deploy CloudFormation, S3 and IAM (user, managed policy, access keys). The default profile has region `ap-southeast-1` (a hint only). Use another profile with `--profile <name>`; set the region with `AWS_REGION=<region>` or in the profile.

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

## API credentials (local/dev)

For the Tech Lead. Every `aws` command here runs with **your own** admin profile (add `--profile <name>` if it is not the default), except the check in step 4. The API user has no IAM rights, so it cannot manage its own keys. No key is ever in this repo, in CloudFormation or in a stack output.

### 1. Deploy

```sh
npx cdk diff
npx cdk deploy
```

The diff must show two new resources (`AWS::IAM::ManagedPolicy`, `AWS::IAM::User`) and two new outputs. The bucket already exists and is `RETAIN`: the diff must show it **unchanged**. If the diff touches the bucket, stop. `cdk deploy` asks you to approve the IAM change ("This deployment will make potentially sensitive changes"). That is expected, so answer `y`.

### 2. Create the key

Run this yourself in your own terminal, not through an agent:

```sh
aws iam create-access-key --user-name renovix-ai-assets-dev-api
```

The output shows `AccessKeyId` and `SecretAccessKey`. The secret is shown **once only**. Put the two values straight into `.env` (step 3) and keep no other copy (no notes, no chat, no screenshot). If you lose the secret, delete that key and create a new one.

### 3. `.env` values

In the repo-root `.env` (see `.env.example`):

```sh
S3_BUCKET=renovix-ai-assets-dev
S3_REGION=<the region the stack was deployed to>
S3_ACCESS_KEY_ID=<ACCESS_KEY_ID>
S3_SECRET_ACCESS_KEY=<SECRET_ACCESS_KEY>
S3_ENDPOINT=""
S3_CDN_DOMAIN=""
```

- `S3_REGION` must equal the bucket's region, otherwise presigned URLs break. Check it with `aws s3api get-bucket-location --bucket renovix-ai-assets-dev` (`null` means `us-east-1`).
- `S3_CDN_DOMAIN` must be empty, otherwise presigned URLs break. There is no CDN in front of the bucket.
- `S3_ENDPOINT` is empty for AWS. It is only for MinIO or another S3-compatible host.

### 4. Check

Test the new key with a temporary named profile. `aws configure` prompts for the values, so the secret does not end up in your shell history:

```sh
aws configure --profile renovix-assets-check
# AWS Access Key ID: <ACCESS_KEY_ID>, AWS Secret Access Key: <SECRET_ACCESS_KEY>,
# Default region name: the S3_REGION value, Default output format: leave empty
aws s3 ls s3://renovix-ai-assets-dev --profile renovix-assets-check
```

The listing must succeed (exit 0; an empty bucket prints nothing). As a negative check, `aws s3 ls --profile renovix-assets-check` (all buckets) must fail with `AccessDenied`, because the user has no `s3:ListAllMyBuckets`. The profile is a second copy of the key: afterwards, delete the `[renovix-assets-check]` section from `~/.aws/credentials` and the `[profile renovix-assets-check]` section from `~/.aws/config`.

### 5. Rotate

A user can have at most two access keys, so rotation never needs downtime:

```sh
aws iam list-access-keys --user-name renovix-ai-assets-dev-api
aws iam create-access-key --user-name renovix-ai-assets-dev-api
# put the new values in .env, restart the API, check uploads work
aws iam update-access-key --user-name renovix-ai-assets-dev-api --access-key-id <OLD_ACCESS_KEY_ID> --status Inactive
# after you are sure nothing still uses the old key:
aws iam delete-access-key --user-name renovix-ai-assets-dev-api --access-key-id <OLD_ACCESS_KEY_ID>
```

If `create-access-key` fails with `LimitExceeded`, the user already has two keys: delete the unused one first.

### 6. Destroy

CloudFormation cannot delete a user that still has access keys. Delete them first, then destroy (see [Destroy](#destroy)):

```sh
aws iam list-access-keys --user-name renovix-ai-assets-dev-api
aws iam delete-access-key --user-name renovix-ai-assets-dev-api --access-key-id <ACCESS_KEY_ID>   # for each key listed
```

## Destroy

The bucket is `RETAIN`. `npx cdk destroy` removes the stack, including the IAM user and its policy, but keeps the bucket and its objects. To remove the bucket, empty and delete it by hand afterwards. Delete the user's access keys before `cdk destroy`, or the stack delete fails on the user (see [API credentials, step 6](#6-destroy)).

## Open questions

- Which account/region or profile is the target for dev (and later prod)?
- CDN: is CloudFront in front of the bucket needed (`S3_CDN_DOMAIN`)? Not added.
- Browser uploads with presigned URLs from the chat app need CORS on the bucket. Not added.
- Lifecycle/expiry rules and versioning for dev objects? Not added.
- How does the API get credentials in prod: IAM user with keys, or a role (RX-165)? For dev, this stack creates the IAM user `renovix-ai-assets-dev-api` (RX-176); its access key is created by hand, never by the stack.
- Bucket name for prod? Names are global, so `renovix-ai-assets-dev` may also be taken.
