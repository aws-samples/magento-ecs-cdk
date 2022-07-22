import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MagentoStack } from '../src/main';

//https://docs.aws.amazon.com/cdk/v2/guide/testing.html
describe('Magento Stack with Admin, EFS, default VPC, ec2 Capacity Providers', () => {
  const app = new App({
    context: {
      vpc_tag_name: 'default',

      route53_domain_zone: 'magento.mydomain.com',
      magento_admin_task: 'yes',
      useEFS: 'yes', // We don't use EFS for this test
      createEFS: 'yes',
      ec2Cluster: 'yes',
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

  test('For Mandatory Infra Constructs have been created With EFS', () => {
    // Assert it creates the function with the correct properties...
    template.hasResourceProperties('AWS::ECS::Service', {
      ServiceName: 'MagentoService',
    });
    template.hasResourceProperties('AWS::ECS::Service', {
      ServiceName: 'MagentoServiceAdmin',
    });

    //needs to have Autoscaling group created
    template.resourceCountIs('AWS::AutoScaling::AutoScalingGroup', 1);
    template.resourceCountIs('AWS::ECS::CapacityProvider', 1);

    // Creates the subscription...
    template.resourceCountIs('AWS::RDS::DBInstance', 1);
    template.resourceCountIs('AWS::RDS::DBCluster', 1);
    template.resourceCountIs('AWS::OpenSearchService::Domain', 1);
    template.resourceCountIs('AWS::ECS::Service', 2);

    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
  });

  test('EFS must have been created', () => {
    template.resourceCountIs('AWS::EFS::FileSystem', 1);
    template.resourceCountIs('AWS::EFS::MountTarget', 2); //1 in each VPC
    template.resourceCountIs('AWS::EFS::AccessPoint', 1);
  });

  test('Check Snapshot', () => {
    expect(app.synth().getStackArtifact(stack.artifactId).template).toMatchSnapshot();
  });
});
