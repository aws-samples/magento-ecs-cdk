import { aws_fsx as fsx, CfnOutput, RemovalPolicy, Size, Stack, StackProps, Tags } from 'aws-cdk-lib';
import {
  AutoScalingGroup,
  BlockDevice,
  BlockDeviceVolume,
  EbsDeviceVolumeType,
  GroupMetrics,
  Monitoring,
} from 'aws-cdk-lib/aws-autoscaling';
import {
  InstanceType,
  InterfaceVpcEndpointAwsService,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc,
} from 'aws-cdk-lib/aws-ec2';
import {
  AmiHardwareType,
  AsgCapacityProvider,
  AssetImage,
  Cluster,
  ContainerImage,
  EcsOptimizedImage,
  ExecuteCommandLogging,
} from 'aws-cdk-lib/aws-ecs';
import { AccessPoint, FileSystem, LifecyclePolicy, PerformanceMode, ThroughputMode } from 'aws-cdk-lib/aws-efs';
import { CfnCacheCluster, CfnSubnetGroup } from 'aws-cdk-lib/aws-elasticache';
import { ManagedPolicy, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Key } from 'aws-cdk-lib/aws-kms';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import { AuroraMysqlEngineVersion, Credentials, DatabaseCluster, DatabaseClusterEngine } from 'aws-cdk-lib/aws-rds';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cfninc from 'aws-cdk-lib/cloudformation-include';
import * as cxapi from 'aws-cdk-lib/cx-api';
import { Construct } from 'constructs';
import { MagentoService } from './magento';

//https://www.npmjs.com/package/@aws-cdk-containers/ecs-service-extensions?activeTab=readme
export interface MagentoStackProps extends StackProps {
  clusterName: string;
  createCluster: boolean; // Specify if you want to reuse existing ECS cluster, else it will create new one
}

/*
 ** Creation of the Stack
 */
export class MagentoStack extends Stack {
  constructor(scope: Construct, id: string, props: MagentoStackProps) {
    super(scope, id, props);
    const stack = Stack.of(this);
    //https://docs.aws.amazon.com/cdk/api/latest/docs/aws-ecs-patterns-readme.html#use-the-remove_default_desired_count-feature-flag
    stack.node.setContext(cxapi.ECS_REMOVE_DEFAULT_DESIRED_COUNT, true);

    let stackName = this.stackName;
    if (stackName.length > 13) {
      throw 'CDK_STACK_NAME value must be < 13 characters';
    }

    //Create or Reuse VPC
    var vpc = undefined;
    const vpcTagName = this.node.tryGetContext('vpc_tag_name') || undefined;
    if (vpcTagName) {
      if (vpcTagName == 'default') {
        vpc = Vpc.fromLookup(this, 'VPC', { isDefault: true });
      } else {
        vpc = Vpc.fromLookup(this, 'VPC', { tags: { Name: vpcTagName } });
      }
    } else {
      vpc = new Vpc(this, 'VPC', { maxAzs: 2 });
    }
    const privateSubnetIds = vpc.selectSubnets({ subnetType: SubnetType.PRIVATE_WITH_NAT }).subnetIds;

    let privateRouteTablesIds: string[] = [];
    vpc.privateSubnets.forEach((subnet) => {
      privateRouteTablesIds.push(subnet.routeTable.routeTableId);
    });

    //new CfnOutput(this, 'privateroutetableid', { value: privateRouteTablesIds });

    const enablePrivateLink = this.node.tryGetContext('enablePrivateLink');
    if (enablePrivateLink == 'true') {
      vpc.addInterfaceEndpoint('CWEndpoint', { service: InterfaceVpcEndpointAwsService.CLOUDWATCH });
      vpc.addInterfaceEndpoint('EFSEndpoint', { service: InterfaceVpcEndpointAwsService.ELASTIC_FILESYSTEM });
      vpc.addInterfaceEndpoint('SMEndpoint', { service: InterfaceVpcEndpointAwsService.SECRETS_MANAGER });
    }

    // Create kms key for secure logging and secret store encryption
    // docs.aws.amazon.com/AmazonCloudWatch/latest/logs/encrypt-log-data-kms.html
    const kmsKey = new Key(this, 'ECSKmsKey', {
      alias: id + '-kms-ecs-' + props.clusterName,
    });
    new CfnOutput(stack, 'EcsKMSAlias', { value: kmsKey.keyArn });

    // Secure ecs exec loggings
    const execLogGroup = new LogGroup(this, 'ECSExecLogGroup', {
      removalPolicy: RemovalPolicy.DESTROY,
      logGroupName: '/ecs/secu/exec/' + props.clusterName,
      encryptionKey: kmsKey,
    });
    new CfnOutput(stack, 'EcsExecLogGroupOut', { value: execLogGroup.logGroupName });
    const execBucket = new Bucket(this, 'EcsExecBucket', {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryptionKey: kmsKey,
    });
    new CfnOutput(stack, 'EcsExecBucketOut', { value: execBucket.bucketName });

    /**
     * Password Creations
     *
     */
    const magentoPassword = new secretsmanager.Secret(this, 'magentoAdminPassword', {
      secretName: id + '-magento',
      description: 'magento password for ' + stackName,
      encryptionKey: kmsKey,
      generateSecretString: {
        excludeCharacters: '|-,\'"',
        includeSpace: false,
        excludePunctuation: true,
      },
    });
    new CfnOutput(stack, 'MagentoAdminPasswordOutput', { value: magentoPassword.toString() });

    /* The master user password must
     * contain at least one uppercase letter, one lowercase letter, one number, and one special character.
     */
    const magentoOpensearchAdminPassword = new secretsmanager.Secret(this, 'opensearchAdminPassword', {
      secretName: id + '-magento-opensearch-admin-password',
      description: 'magento Opensearch Admin password for ' + stackName,
      encryptionKey: kmsKey,
      generateSecretString: {
        excludeCharacters: '|-,\'":@/<>;()[]{}/&`?#*.%$!~^_+',
        includeSpace: false,
        excludePunctuation: false,
      },
    });
    new CfnOutput(stack, 'MagentoOpensearchAdminPasswordOutput', {
      value: magentoOpensearchAdminPassword.toString(),
    });

    const magentoDatabasePassword = new secretsmanager.Secret(this, 'MagentoDatabasePassword', {
      secretName: id + '-magento-database-password',
      description: 'magento Database password for ' + stackName,
      encryptionKey: kmsKey,
      generateSecretString: {
        excludeCharacters: '|-,\'":@/<>;',
        includeSpace: false,
        excludePunctuation: true,
      },
    });
    new CfnOutput(stack, 'MagentoDatabasePasswordOutput', { value: magentoDatabasePassword.toString() });

    var ec2Cluster: boolean = false; // By default I uses Fargate Cluster
    const contextEc2Cluster = this.node.tryGetContext('ec2Cluster');
    if (contextEc2Cluster == 'yes' || contextEc2Cluster == 'true') {
      ec2Cluster = true;
    }
    let asg1: AutoScalingGroup;
    let cp1: AsgCapacityProvider;
    if (ec2Cluster) {
      //https://github.com/PasseiDireto/gh-runner-ecs-ec2-stack/blob/cc6c13824bec5081e2d39a7adf7e9a2d0c8210a1/cluster.ts

      /*
       ** Configure Security Group for FsX
       */
      //docs.aws.amazon.com/fsx/latest/ONTAPGuide/limit-access-security-groups.html
      const ec2SecurityGroup = new SecurityGroup(this, 'ec2SecurityGroup', {
        vpc,
        description: 'ec2 instance securitygroup',
        allowAllOutbound: true,
      });
      const fsxSecurityGroup = new SecurityGroup(this, 'fsxSecurityGroup', {
        vpc,
        description: 'fsx service securitygroup',
        allowAllOutbound: true,
      });
      fsxSecurityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(2049), 'allow 2049 inbound from ec2');
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.icmpPing());
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.tcp(22));
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.tcp(111));
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.tcp(135));
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.tcp(139));
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.tcp(161));
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.tcp(162));
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.tcp(443));
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.tcp(445));
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.tcp(635));
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.tcp(749));
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.tcp(2049));
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.tcp(3260));
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.tcp(4045));
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.tcp(4046));
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.tcp(11104));
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.tcp(11105));
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.udp(111));
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.udp(135));
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.udp(137));
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.udp(139));
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.udp(161));
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.udp(162));
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.udp(635));
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.udp(2049));
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.udp(4045));
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.udp(4046));
      fsxSecurityGroup.addIngressRule(ec2SecurityGroup, Port.udp(4049));

      //Create FsX OnTap storage
      const cfnFileSystem = new fsx.CfnFileSystem(this, 'MyCfnFileSystem', {
        fileSystemType: 'ONTAP',
        subnetIds: [privateSubnetIds[0], privateSubnetIds[1]], // At most 2 subnets are allowed. (Service: AmazonFSx

        // the properties below are optional
        ontapConfiguration: {
          deploymentType: 'MULTI_AZ_1',

          // the properties below are optional
          diskIopsConfiguration: {
            iops: 40000,
            mode: 'USER_PROVISIONED',
          },
          fsxAdminPassword: 'N3tapp1!', //TODO: configure this
          preferredSubnetId: privateSubnetIds[0], //used for the writes
          routeTableIds: privateRouteTablesIds,
          throughputCapacity: 256,
        },
        securityGroupIds: [fsxSecurityGroup.securityGroupId],
        storageCapacity: 10240,
        storageType: 'SSD',
      });

      const template = new cfninc.CfnInclude(this, 'Template', {
        templateFile: './src/svm_volume.yaml',
        parameters: {
          MagentoFsId: cfnFileSystem.ref,
        },
        preserveLogicalIds: false,
      });

      var svmId = template.getResource('magentoSVM');

      const asgRole = new Role(this, 'AsgRole', {
        assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
      });
      const ssmManagedPolicy = ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore');
      asgRole.addManagedPolicy(ssmManagedPolicy);

      //gp3 block device for instances
      const blockDeviceVolume = BlockDeviceVolume.ebs(30, {
        deleteOnTermination: true,
        encrypted: false,
        volumeType: EbsDeviceVolumeType.GP3,
      });

      const blockDevice: BlockDevice = {
        deviceName: '/dev/xvda',
        volume: blockDeviceVolume,
      };

      const ec2InstanceType = this.node.tryGetContext('ec2InstanceType') || 'c5.xlarge';
      asg1 = new AutoScalingGroup(this, 'Asg1', {
        vpc: vpc,
        //autoScalingGroupName: id,
        machineImage: EcsOptimizedImage.amazonLinux2(AmiHardwareType.STANDARD),

        instanceType: new InstanceType(ec2InstanceType),
        securityGroup: ec2SecurityGroup,
        minCapacity: 1,
        maxCapacity: 40,
        instanceMonitoring: Monitoring.DETAILED,
        groupMetrics: [GroupMetrics.all()],
        // https://github.com/aws/aws-cdk/issues/11581
        role: asgRole,
        blockDevices: [blockDevice],
      }); //asg1.addToRolePolicy()

      var dnsName = `${svmId.ref}.${cfnFileSystem.ref}.fsx.${this.region}.amazonaws.com`;

      const mountPath = '/mnt/fsx';
      const mountName = '/datavol';

      new CfnOutput(this, 'FsXDnsName', { value: dnsName });

      asg1.userData.addCommands(
        //'sudo su',
        //'yum update -y',
        // Set up the directory to mount the file system to and change the owner to the AL2 default ec2-user.
        `mkdir -p ${mountPath}`,
        // Set the file system up to mount automatically on start up and mount it.
        //echo "${dnsName}:${mountName} ${mountPath} nfs4 vers=3,rsize=8192,wsize=8192,nocto,nconnect=8" >> /etc/fsta
        //`echo "${dnsName}:${mountName} ${mountPath} nfs vers=3,rsize=262144,wsize=262144,nocto,nconnect=8" >> /etc/fstab`,
        `echo "${dnsName}:${mountName} ${mountPath} nfs vers=3,rsize=262144,wsize=262144,nocto 0 0" >> /etc/fstab`,
        'mount -a',
        `chown 1:1 ${mountPath}`,
      );

      cp1 = new AsgCapacityProvider(this, 'CP1', {
        //capacityProviderName: props.clusterName,
        autoScalingGroup: asg1,
        enableManagedScaling: true,
        enableManagedTerminationProtection: true,
        targetCapacityPercent: 100, //do some over-provisionning
      });
    }

    // Create or Reuse ECS Cluster
    // Reference existing network and cluster infrastructure
    var cluster = undefined;
    if (!props.createCluster) {
      cluster = Cluster.fromClusterAttributes(this, 'Cluster', {
        clusterName: props.clusterName,
        vpc: vpc,
        securityGroups: [],
      });
    } else {
      /*
       ** Create new ECS Cluster witrh ecs exec logging enable
       */
      cluster = new Cluster(this, 'Cluster', {
        clusterName: props.clusterName,
        vpc,
        containerInsights: true,
        enableFargateCapacityProviders: true,
        executeCommandConfiguration: {
          kmsKey,
          logConfiguration: {
            cloudWatchLogGroup: execLogGroup,
            cloudWatchEncryptionEnabled: true,
            s3Bucket: execBucket,
            s3EncryptionEnabled: true,
            s3KeyPrefix: 'exec-command-output',
          },
          logging: ExecuteCommandLogging.OVERRIDE,
        },
      });
      //Cast cluster to Cluster instead of ICluster
      if (ec2Cluster) {
        //const cluster = cluster as Cluster;
        cluster.addAsgCapacityProvider(cp1!);
      }
    }
    new CfnOutput(this, 'ClusterName', { value: cluster.clusterName });

    /*
     ** Configure Flows security group in VPC
     */
    const efsFileSystemSecurityGroup = new SecurityGroup(this, 'EfsFileSystemSecurityGroup', { vpc });

    //NFS security group which used for ec2 to copy file
    //TODO: maybe thoses lines are not used anyzhere
    const sgNFSSG = new SecurityGroup(this, 'NFSAllowAllSG', {
      vpc: vpc,
      description: 'allow 2049 inbound for ec2',
      allowAllOutbound: true,
    });
    sgNFSSG.addIngressRule(Peer.anyIpv4(), Port.tcp(2049), 'allow 2049 inbound from ec2');
    //end-TODO

    //ALB security group which allow 80 and 443
    const albSG = new SecurityGroup(this, 'albSG', {
      vpc: vpc,
      description: 'allow 80 and 443',
      allowAllOutbound: true,
    });
    albSG.addIngressRule(Peer.anyIpv4(), Port.tcp(80), 'allow 80 inbound');
    albSG.addIngressRule(Peer.anyIpv4(), Port.tcp(443), 'allow 443 inbound');

    //EC2 security group which allow port 22
    const ec2SG = new SecurityGroup(this, 'ec2SG', {
      vpc: vpc,
      description: 'allow 22 inbound for ec2',
      allowAllOutbound: true,
    });
    ec2SG.addIngressRule(Peer.anyIpv4(), Port.tcp(22), 'allow 22 inbound from ec2');

    // RDS security group which allow port 3306
    const rdsSG = new SecurityGroup(this, 'magentoRDSSecurityGroup', {
      vpc: vpc,
      description: 'allow 3306 inbound',
      allowAllOutbound: true,
    });
    rdsSG.addIngressRule(Peer.anyIpv4(), Port.tcp(3306), 'allow 3306 inbound from lambda');

    // OpenSearch security group which allow port 3306
    const openSearchSG = new SecurityGroup(this, 'openSearchSecurityGroup', {
      vpc: vpc,
      description: 'allow All inbound',
      allowAllOutbound: true,
    });

    // Fargatge Service Security Group
    const serviceSG = new SecurityGroup(this, 'serviceSecurityGroup', {
      vpc: vpc,
      description: 'ecs service securitygroup',
      allowAllOutbound: true,
    });
    efsFileSystemSecurityGroup.addIngressRule(serviceSG, Port.tcp(2049));

    /*
     ** Create RDS Aurora Mysql database
     */
    const DB_NAME = this.node.tryGetContext('db_name') ? this.node.tryGetContext('db_name') : stackName;
    const DB_USER = this.node.tryGetContext('db_user') ? this.node.tryGetContext('db_user') : 'magentouser';

    //const secret = SecretValue.plainText(magentoDatabasePassword.toString());
    const secret = magentoDatabasePassword.secretValue;
    const rdsInstanceType = this.node.tryGetContext('rdsInstanceType') || 'r6g.large';
    const db = new DatabaseCluster(this, 'MagentoAuroraCluster', {
      engine: DatabaseClusterEngine.auroraMysql({ version: AuroraMysqlEngineVersion.VER_2_10_1 }),
      credentials: Credentials.fromPassword(DB_USER, secret),
      removalPolicy: RemovalPolicy.DESTROY,
      instances: 1,
      instanceProps: {
        vpc: vpc,
        //instanceType: InstanceType.of(InstanceClass.MEMORY6_GRAVITON, InstanceSize.XLARGE16),
        instanceType: new InstanceType(rdsInstanceType),
        securityGroups: [rdsSG],
      },
      defaultDatabaseName: DB_NAME,
    });

    const elastiCacheSecurityGroup = new SecurityGroup(this, 'ElasticacheSecurityGroup', {
      vpc: vpc,
      description: 'Allow Redis port from ECS',
      allowAllOutbound: true,
    });

    elastiCacheSecurityGroup.addIngressRule(serviceSG, Port.tcp(6379));

    const subnetGroup = new CfnSubnetGroup(this, 'RedisClusterPrivateSubnetGroup', {
      cacheSubnetGroupName: `${stackName}-redis-cache`,
      subnetIds: privateSubnetIds,
      description: 'Private Subnet Group for Magento Elasticache',
    });

    const cacheInstanceType = this.node.tryGetContext('cacheInstanceType') || 'r6g.large';
    const redis = new CfnCacheCluster(this, 'RedisCluster', {
      engine: 'redis',
      cacheNodeType: 'cache.' + cacheInstanceType,
      numCacheNodes: 1,
      clusterName: `${stackName}magento-elasticache`,
      vpcSecurityGroupIds: [elastiCacheSecurityGroup.securityGroupId],
      cacheSubnetGroupName: subnetGroup.cacheSubnetGroupName,
    });
    redis.addDependsOn(subnetGroup);

    /*
     ** Create OpenSearch cluster with fine-grained access control only
     * https://code.amazon.com/packages/D16GConstructsCDK/blobs/mainline/--/src/aws-elasticsearch/elasticsearch.ts
     * **
     * If a resource-based access policy contains IAM users or roles, clients must send signed requests using AWS Signature Version 4.
     * As such, access policies can conflict with fine-grained access control, especially if you use the internal user database and
     * HTTP basic authentication. You can't sign a request with a user name and password and IAM credentials. In general, if you enable
     * fine-grained access control, we recommend using a domain access policy that doesn't require signed requests.
     *
     */
    const OS_DOMAIN = this.node.tryGetContext('os_domain') ? this.node.tryGetContext('os_domain') : stackName;
    const OS_MASTER_USER_NAME = this.node.tryGetContext('os_master_user_name')
      ? this.node.tryGetContext('os_master_user_name')
      : 'magento-os-master';

    const OS_DOMAIN_ENDPOINT = this.node.tryGetContext('os_domain_endpoint')
      ? this.node.tryGetContext('os_domain_endpoint')
      : undefined;

    //TODO: Create opensearch private
    var osDomain;
    if (OS_DOMAIN_ENDPOINT) {
      // If we uses an existing OpenSearch Domain
      osDomain = opensearch.Domain.fromDomainEndpoint(this, 'domainImport', OS_DOMAIN_ENDPOINT);
    } else {
      osDomain = new opensearch.Domain(this, 'Domain', {
        version: opensearch.EngineVersion.OPENSEARCH_1_0,
        domainName: OS_DOMAIN,
        //accessPolicies: [osPolicy], // Default No access policies for magento
        removalPolicy: RemovalPolicy.DESTROY,
        securityGroups: [openSearchSG],
        //If you want more capacity for Opensearch . default 1 instance r5.large.search datanode; no dedicated master nodes
        // capacity: {
        //   masterNodes: 5,
        //   dataNodes: 20,
        // },
        ebs: {
          volumeSize: 20,
        },
        //if you need, else only 1 az
        // zoneAwareness: {
        //   availabilityZoneCount: 3,
        // },
        logging: {
          slowSearchLogEnabled: true,
          appLogEnabled: true,
          slowIndexLogEnabled: true,
        },

        //encryption
        enforceHttps: true,
        nodeToNodeEncryption: true,
        encryptionAtRest: {
          enabled: true,
        },
        fineGrainedAccessControl: {
          masterUserName: OS_MASTER_USER_NAME,
          masterUserPassword: magentoOpensearchAdminPassword.secretValue,
        },
        useUnsignedBasicAuth: true,
        enableVersionUpgrade: true,
      });
    }
    new CfnOutput(this, 'EsDomainEndpoint', { value: osDomain.domainEndpoint });
    new CfnOutput(this, 'EsDomainName', { value: osDomain.domainName });
    new CfnOutput(this, 'EsMasterUserPassword', { value: magentoOpensearchAdminPassword.secretValue.toString() });
    process.env.elasticsearch_host = osDomain.domainEndpoint;

    var useFSX: boolean = false; // By default I don't want EFS, it's too slow
    const contextUseFSX = this.node.tryGetContext('useFSX');
    if (contextUseFSX == 'yes' || contextUseFSX == 'true') {
      useFSX = true;
    }

    var createEFS: boolean = false; // By default I don't want EFS, it's too slow
    const contextCreateEFS = this.node.tryGetContext('createEFS');
    if (contextCreateEFS == 'yes' || contextCreateEFS == 'true') {
      createEFS = true;
    }
    var useEFS: boolean = false; // By default I don't want EFS, it's too slow
    const contextUseEFS = this.node.tryGetContext('useEFS');
    if (contextUseEFS == 'yes' || contextUseEFS == 'true') {
      useEFS = true;
    }

    if (useEFS && useFSX) {
      throw 'useEFS and useFSX are exclusive';
    }
    if (useEFS && !createEFS) {
      throw 'useEFS must be used with createEFS';
    }

    var efsFileSystem: FileSystem;
    var fileSystemAccessPoint: AccessPoint;
    if (createEFS) {
      /*
       ** Create EFS File system
       */
      efsFileSystem = new FileSystem(this, 'FileSystem', {
        vpc,
        securityGroup: efsFileSystemSecurityGroup,
        performanceMode: PerformanceMode.GENERAL_PURPOSE,
        lifecyclePolicy: LifecyclePolicy.AFTER_30_DAYS,
        throughputMode: ThroughputMode.PROVISIONED,
        provisionedThroughputPerSecond: Size.mebibytes(1024),
        encrypted: true,
        removalPolicy: RemovalPolicy.DESTROY, //props.removalPolicy,
      });
      Tags.of(efsFileSystem).add('Name', this.stackName);

      /* I can't activate EFS AccessPoint because Magento init scripts are doing chown on the root volume which zre forbidden when using accesPoints */
      fileSystemAccessPoint = efsFileSystem.addAccessPoint('AccessPoint', {
        path: '/bitnami/magento',
        posixUser: {
          gid: '1', // daemon user of magento docker image
          uid: '1',
        },
        createAcl: {
          ownerGid: '1',
          ownerUid: '1',
          permissions: '777',
        },
      });
    }

    /*
     ** Create our Magento Service, Load Balancer and Lookup Certificates and route53_zone
     */
    var magentoImage: AssetImage;
    if (useEFS || useFSX) {
      magentoImage = ContainerImage.fromAsset('./docker/', { file: 'Dockerfile' });
    } else {
      magentoImage = ContainerImage.fromAsset('./docker/', { file: 'Dockerfile.noefs' });
    }

    const magento = new MagentoService(this, 'MagentoService', {
      vpc: vpc,
      cluster: cluster!,
      ec2Cluster: ec2Cluster,
      capacityProviderName: ec2Cluster ? cp1!.capacityProviderName : 'undefined',
      magentoPassword: magentoPassword,
      magentoImage: magentoImage,
      useFSX: useFSX,
      useEFS: useEFS,
      efsFileSystem: efsFileSystem!,
      fileSystemAccessPoint: fileSystemAccessPoint!,
      db: db,
      dbUser: DB_USER,
      dbName: DB_NAME,
      dbPassword: magentoDatabasePassword,
      osDomain: osDomain,
      osUser: OS_MASTER_USER_NAME,
      osPassword: magentoOpensearchAdminPassword,
      kmsKey: kmsKey,
      execBucket: execBucket,
      execLogGroup: execLogGroup,
      serviceSG: serviceSG,
      cacheEndpoint: redis.attrRedisEndpointAddress,
    });
    magento;
    // if (props.createCluster && ec2Cluster) {
    //   magento.node.addDependency(cluster!);
    // }
    //allow to communicate with OpenSearch
    openSearchSG.addIngressRule(serviceSG, Port.allTraffic(), 'allow traffic fom ECS service');
    serviceSG.addIngressRule(openSearchSG, Port.allTraffic(), 'allow traffic fom Opensearch');

    // Add Magento Admin Task
    const magentoAdminTask = this.node.tryGetContext('magento_admin_task');
    var magentoAdminTaskDebug: boolean = false;
    const contextMagentoAdminTaskDebug = this.node.tryGetContext('magento_admin_task_debug');
    if (contextMagentoAdminTaskDebug == 'yes' || contextMagentoAdminTaskDebug == 'true') {
      magentoAdminTaskDebug = true;
    }
    if (magentoAdminTask == 'yes') {
      const magentoServiceAdmin = new MagentoService(this, 'MagentoServiceAdmin', {
        vpc: vpc,
        cluster: cluster!,
        ec2Cluster: ec2Cluster,
        capacityProviderName: ec2Cluster ? cp1!.capacityProviderName : 'undefined',
        magentoPassword: magentoPassword,
        magentoImage: magentoImage,
        useFSX: useFSX,
        useEFS: useEFS,
        efsFileSystem: efsFileSystem!,
        fileSystemAccessPoint: fileSystemAccessPoint!,
        db: db,
        dbUser: DB_USER,
        dbName: DB_NAME,
        dbPassword: magentoDatabasePassword,
        osDomain: osDomain,
        osUser: OS_MASTER_USER_NAME,
        osPassword: magentoOpensearchAdminPassword,
        serviceSG: serviceSG,
        kmsKey: kmsKey,
        execBucket: execBucket,
        execLogGroup: execLogGroup,
        magentoAdminTask: true,
        magentoAdminTaskDebug: magentoAdminTaskDebug,
        mainStackALB: magento.getALB(),
        cacheEndpoint: redis.attrRedisEndpointAddress,
      });
      magentoServiceAdmin;
      //magentoServiceAdmin.node.addDependency(cluster);
    }
  }
}
