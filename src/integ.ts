import { App } from 'aws-cdk-lib';
import { MagentoStack } from './main';

const stackName = process.env.CDK_STACK_NAME ? process.env.CDK_STACK_NAME : 'magento';
const clusterName = stackName;

// Check if we're running in GitHub Actions with fake AWS
const useFakeAws = process.env.CDK_FAKE_AWS === 'true';

const devEnv = useFakeAws
  ? {
    account: '1234567890', // Fake account ID
    region: 'us-east-1', // Fake region
  }
  : {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  };

const app = new App();

// If using fake AWS, set the context
if (useFakeAws) {
  app.node.setContext('@aws-cdk/core:enableFakeAws', true);
  app.node.setContext('aws-cdk:enableFakeAws', true);
}

new MagentoStack(app, stackName, {
  clusterName: clusterName,
  createCluster: true,
  description: 'This stack creates the stack required to host a Magento ecommerce application',
  env: devEnv,
});

app.synth();
