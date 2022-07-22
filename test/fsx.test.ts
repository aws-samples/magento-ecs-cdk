import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MagentoStack } from '../src/main';

//https://docs.aws.amazon.com/cdk/v2/guide/testing.html
describe('Magento Stack with Admin, FSX, default VPC, ec2 Capacity Providers', () => {
  const app = new App({
    context: {
      vpc_tag_name: 'default',

      route53_domain_zone: 'magento.mydomain.com',
      magento_admin_task: 'yes',
      useFSX: 'yes',
      createEFS: 'no',
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

    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: [
        {
          Environment: [
            {
              Name: 'BITNAMI_DEBUG',
              Value: 'true',
            },
            {
              Name: 'MAGENTO_USERNAME',
              Value: 'magento',
            },
            {
              Name: 'MAGENTO_ADMIN_TASK',
              Value: 'yes',
            },
            {
              Name: 'MAGENTO_DEPLOY_STATIC_CONTENT',
              Value: 'yes',
            },
            {
              Name: 'MAGENTO_SKIP_REINDEX',
              Value: 'no',
            },
            {
              Name: 'MAGENTO_SKIP_BOOTSTRAP',
              Value: 'no',
            },
            {
              Name: 'MAGENTO_EXTRA_INSTALL_ARGS',
              Value: {
                'Fn::Join': [
                  '',
                  [
                    '--cache-backend=redis --cache-backend-redis-server=',
                    {
                      'Fn::GetAtt': ['RedisCluster', 'RedisEndpoint.Address'],
                    },
                    ' --cache-backend-redis-port=6379 --cache-backend-redis-db=0 --session-save=redis --session-save-redis-host=',
                    {
                      'Fn::GetAtt': ['RedisCluster', 'RedisEndpoint.Address'],
                    },
                    ' --session-save-redis-db=2',
                  ],
                ],
              },
            },
            {
              Name: 'MAGENTO_HOST',
              Value: 'magento.magento.mydomain.com',
            },
            {
              Name: 'MAGENTO_ENABLE_HTTPS',
              Value: 'yes',
            },
            {
              Name: 'MAGENTO_ENABLE_ADMIN_HTTPS',
              Value: 'yes',
            },
            {
              Name: 'MAGENTO_MODE',
              Value: 'production',
            },
            {
              Name: 'MAGENTO_USE_FS',
              Value: 'yes',
            },
            {
              Name: 'MAGENTO_DATABASE_HOST',
              Value: {
                'Fn::GetAtt': ['MagentoAuroraCluster576B8023', 'Endpoint.Address'],
              },
            },
            {
              Name: 'MAGENTO_DATABASE_PORT_NUMBER',
              Value: '3306',
            },
            {
              Name: 'MAGENTO_DATABASE_USER',
              Value: 'magentouser',
            },
            {
              Name: 'MAGENTO_DATABASE_NAME',
              Value: 'magento',
            },
            {
              Name: 'ELASTICSEARCH_HOST',
              Value: {
                'Fn::GetAtt': ['Domain66AC69E0', 'DomainEndpoint'],
              },
            },
            {
              Name: 'ELASTICSEARCH_PORT_NUMBER',
              Value: '443',
            },
            {
              Name: 'MAGENTO_ELASTICSEARCH_USE_HTTPS',
              Value: 'yes',
            },
            {
              Name: 'MAGENTO_ELASTICSEARCH_ENABLE_AUTH',
              Value: 'yes',
            },
            {
              Name: 'MAGENTO_ELASTICSEARCH_USER',
              Value: 'magento-os-master',
            },
            {
              Name: 'PHP_MEMORY_LIMIT',
              Value: '7G',
            },
          ],
        },
      ],
    });

    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Volumes: [
        {
          Host: {
            SourcePath: '/mnt/fsx',
          },
          Name: 'MagentoFsxVolume',
        },
      ],
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

  test('FSX must have been created', () => {
    template.resourceCountIs('AWS::FSx::StorageVirtualMachine', 1);
    template.resourceCountIs('AWS::FSx::Volume', 1);
    template.resourceCountIs('AWS::FSx::FileSystem', 1);
  });

  test('EFS must not have been created', () => {
    template.resourceCountIs('AWS::EFS::FileSystem', 0);
    template.resourceCountIs('AWS::EFS::MountTarget', 0); //1 in each VPC
    template.resourceCountIs('AWS::EFS::AccessPoint', 0);
  });

  test('Check Snapshot', () => {
    expect(app.synth().getStackArtifact(stack.artifactId).template).toMatchSnapshot();
  });
});
