import { App } from 'aws-cdk-lib';
import { MagentoStack } from './main';

const stackName = process.env.CDK_STACK_NAME ? process.env.CDK_STACK_NAME : 'magento';
const clusterName = stackName;

const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new App();
new MagentoStack(app, stackName, {
  clusterName: clusterName,
  createCluster: true,
  description: 'This stack creates the stack required to host a Magento ecommerce application',
  env: devEnv,
});

app.synth();
