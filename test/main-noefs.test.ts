import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MagentoStack } from '../src/main';

//https://docs.aws.amazon.com/cdk/v2/guide/testing.html
describe('Magento Stack with No Admin, No EFS', () => {
  const app = new App({
    context: {
      route53_domain_zone: 'magento.mydomain.com',
      magento_admin_task: 'no',
      //useEFS: false, // We don't use EFS for this test
      //createEFS: false,
    },
  });

  const stackName = 'magento';
  const clusterName = stackName;

  const devEnv = {
    account: '1234567890',
    region: 'us-east-1',
  };

  const stack = new MagentoStack(app, stackName, {
    clusterName: clusterName,
    createCluster: true,
    env: devEnv,
  });

  // Prepare the stack for assertions.
  const template = Template.fromStack(stack);

  test('For Mandatory Infra Constructs have been created Without EFS', () => {
    // Assert it creates the function with the correct properties...
    template.hasResourceProperties('AWS::ECS::Service', {
      ServiceName: 'MagentoService',
    });

    // Creates the subscription...
    template.resourceCountIs('AWS::RDS::DBInstance', 1);
    template.resourceCountIs('AWS::RDS::DBCluster', 1);
    template.resourceCountIs('AWS::OpenSearchService::Domain', 1);
    template.resourceCountIs('AWS::ECS::Service', 1);

    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
  });

  test('EFS must not have been created', () => {
    template.resourceCountIs('AWS::EFS::FileSystem', 0);
    template.resourceCountIs('AWS::EFS::MountTarget', 0);
    template.resourceCountIs('AWS::EFS::AccessPoint', 0);
  });

  test('Check Snapshot', () => {
    expect(app.synth().getStackArtifact(stack.artifactId).template).toMatchSnapshot();
  });
});
