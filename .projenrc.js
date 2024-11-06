const { awscdk } = require('projen');
const AUTOMATION_TOKEN = 'PROJEN_GITHUB_TOKEN';

const project = new awscdk.AwsCdkTypeScriptApp({
  authorName: 'Sébastien Allamand',
  authorName: 'sallaman@amazon.com',
  authorOrganization: true,
  repository: 'https://github.com/aws-samples/magento-ecs-cdk.git',
  copyrightPeriod: `2021-${new Date().getFullYear()}`,
  copyrightOwner: 'Amazon.com, Inc. or its affiliates. All Rights Reserved.',
  keywords: ['aws', 'constructs', 'cdk', 'ecs', 'magento', 'fargate', 'opensearch', 'efs', 'fsx'],
  description:
    'CDK Project to deploy Magento Applications on top of AWS ECS, FARGATE/EC2, EFS/FsX Ontap, RDS, OpenSearch, ElastiCashe',
  cdkVersion: '2.165.0',
  defaultReleaseBranch: 'main',
  license: 'MIT',
  name: 'magento-ecs-cdk',
  repositoryUrl: 'https://github.com/aws-samples/magento-ecs-cdk.git',
  appEntrypoint: 'integ.ts',

  depsUpgradeOptions: {
    ignoreProjen: true,
    workflowOptions: {
      labels: ['auto-approve', 'auto-merge'],
      secret: AUTOMATION_TOKEN,
    },
    separateUpgrades: true,
  },

  autoApproveOptions: {
    secret: 'GITHUB_TOKEN',
    allowedUsernames: ['github-actions', 'github-actions[bot]', 'allamand'],
  },

  githubOptions: {
    workflows: true,
  },

  workflowNodeVersion: '20.x', // Specify the Node.js version for the workflow

  workflowContainerImage: 'jsii/superchain:1-buster-slim-node18', // Optional: Use a specific container image

  // Disable the default build workflow
  workflowBootstrapSteps: [],
  buildWorkflow: true,
  workflowBootstrapSteps: [
    {
      name: 'Setup Mock AWS Context',
      run: [
        'echo "CDK_DEFAULT_ACCOUNT=123456789012" >> $GITHUB_ENV',
        'echo "CDK_DEFAULT_REGION=us-east-1" >> $GITHUB_ENV',
        'echo "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE" >> $GITHUB_ENV',
        'echo "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" >> $GITHUB_ENV',
        'echo "AWS_REGION=us-east-1" >> $GITHUB_ENV',
        'echo "CDK_FAKE_AWS=true" >> $GITHUB_ENV',
      ].join('\n'),
    },
  ],
  workflowBuildSteps: [
    {
      name: 'CDK Synth with Mocks',
      run: 'npx cdk synth -c use:aws-cdk-mock',
    },
  ],
  //   workflowBootstrapSteps: [
  //   {
  //     name: 'Custom Bootstrap Step',
  //     run: 'echo "This is a custom bootstrap step"',
  //   },
  // ],
  // workflowBuildSteps: [
  //   {
  //     name: 'Custom Build Step',
  //     run: 'npm run custom-build-script',
  //   },
  // ],

  context: {
    '@aws-cdk/aws-apigateway:usagePlanKeyOrderInsensitiveId': true,
    '@aws-cdk/core:enablePartitionLiterals': true,
    '@aws-cdk/aws-events:eventsTargetQueueSameAccount': true,
    '@aws-cdk/aws-iam:standardizedServicePrincipals': true,
    '@aws-cdk/aws-ecs:disableExplicitDeploymentControllerForCircuitBreaker': true,
    '@aws-cdk/aws-iam:importedRoleStackSafeDefaultPolicyName': true,
    '@aws-cdk/aws-s3:serverAccessLogsUseBucketPolicy': true,
    '@aws-cdk/aws-route53-patters:useFargateAlb': true,
    '@aws-cdk/customresources:installLatestAwsSdkDefault': false,
    'aws-cdk:enableDiffNoFail': true,
    'availability-zones:account-1234567890:us-east-1': ['us-east-1a', 'us-east-1b', 'us-east-1c'],
    'hosted-zone:account=1234567890:domainName=magento.mydomain.com:region=us-east-1': {
      Id: '/hostedzone/MOCKZ3AMJ8IL4',
      Name: 'magento.mydomain.com.',
    },
    'vpc-provider:account=1234567890:filter.tag:Name=default:region=us-east-1:returnAsymmetricSubnets=true': {
      vpcId: 'vpc-1234567890abcdef0',
      vpcCidrBlock: '172.31.0.0/16',
      availabilityZones: [],
      subnetGroups: [
        {
          name: 'Public',
          type: 'Public',
          subnets: [
            {
              subnetId: 'subnet-1234567890abcdef0',
              cidr: '172.31.0.0/20',
              availabilityZone: 'us-east-1a',
              routeTableId: 'rtb-1234567890abcdef0',
            },
            {
              subnetId: 'subnet-1234567890abcdef1',
              cidr: '172.31.16.0/20',
              availabilityZone: 'us-east-1b',
              routeTableId: 'rtb-1234567890abcdef0',
            },
            {
              subnetId: 'subnet-1234567890abcdef2',
              cidr: '172.31.32.0/20',
              availabilityZone: 'us-east-1c',
              routeTableId: 'rtb-1234567890abcdef0',
            },
          ],
        },
      ],
    },

    //vpc_tag_name: 'ecsworkshop-base/BaseVPC', // TAG Name of the VPC to create the cluster into (or 'default' or comment to create new one)
    'enablePrivateLink': 'true', // this parameter seems to works only one

    'createEFS': 'yes', //if yes CDK will create the EFS File System
    'useEFS': 'yes', // if true, /bitnami/magento directory will be mapped to a new empty FSX volume.

    //useFSX: 'yes', // if yes, create en EC2 based cluster (required for FsX), if no create Fargate cluster
    'ec2Cluster': 'no', // if yes, create en EC2 based cluster (required for FsX), if no create Fargate cluster

    // You can customize Instances size
    // ec2InstanceType: 'c5.9xlarge',
    // rdsInstanceType: 'r6g.8xlarge',
    // cacheInstanceType: 'r6g.8xlarge',

    'taskCpu': 1024,
    'taskMem': 4096,
    'phpMemoryLimit': '3G',
    'magentoMinTasks': 10,
    'magentoMaxTasks': 100,

    'route53_domain_zone': 'sallaman.people.aws.dev', // You need ot provide a valide AWS Route53 Hosted Zone.

    'magento_admin_task': 'yes',
    'magento_admin_task_debug': 'no',
  },

  gitignore: [
    'cdk.out',
    'cdk.context.json',
    '*.d.ts',
    '*.js',
    'CMD',
    '.projenrc.js-*',
    '.env*',
    '.vscode',
  ],

  devDeps: ['cdk-nag'], /* Build dependencies for this module. */

});

// Add a custom workflow
const workflow = project.github.addWorkflow('custom-build');

workflow.on({
  push: { branches: ['main'] },
  pullRequest: { branches: ['main'] },
  workflowDispatch: {},
});

workflow.addJobs({
  build: {
    runsOn: ['ubuntu-latest'],
    permissions: {
      contents: 'read',
    },
    steps: [
      { uses: 'actions/checkout@v4', with: { 'node-version': '20.x' } },
      {
        name: 'Setup mock AWS environment',
        run: [
          'echo "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE" >> $GITHUB_ENV',
          'echo "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" >> $GITHUB_ENV',
          'echo "AWS_DEFAULT_REGION=us-east-1" >> $GITHUB_ENV',
          'echo "CDK_DEFAULT_ACCOUNT=1234567890" >> $GITHUB_ENV',
          'echo "CDK_DEFAULT_REGION=us-east-1" >> $GITHUB_ENV',
        ].join('\n'),
      },
      { uses: 'actions/setup-node@v4', with: { 'node-version': '20.x' } },
      { name: 'Install dependencies', run: 'yarn install --check-files' },
      { run: 'npx projen build' },
    ],
  },
});


project.synth();
