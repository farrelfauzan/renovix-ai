import { App } from 'aws-cdk-lib';
import { AssetsStack } from '../lib/assets-stack';

const app = new App();

new AssetsStack(app, 'RenovixAssetsDev', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
