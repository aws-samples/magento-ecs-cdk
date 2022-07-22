/* eslint-disable @typescript-eslint/member-ordering */

import { Aspects, CfnOutput, Duration, IAspect, Stack, Tags } from 'aws-cdk-lib';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { ISecurityGroup, IVpc } from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import {
  AssetImage,
  AwsLogDriver,
  AwsLogDriverMode,
  ContainerDefinitionOptions,
  Ec2Service,
  Ec2TaskDefinition,
  FargatePlatformVersion,
  FargateService,
  FargateTaskDefinition,
  ICluster,
  NetworkMode,
} from 'aws-cdk-lib/aws-ecs';
import { AccessPoint, FileSystem } from 'aws-cdk-lib/aws-efs';
import { ApplicationLoadBalancer } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Key } from 'aws-cdk-lib/aws-kms';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { IDomain } from 'aws-cdk-lib/aws-opensearchservice';
import { IDatabaseCluster } from 'aws-cdk-lib/aws-rds';
import { ARecord, HostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { LoadBalancerTarget } from 'aws-cdk-lib/aws-route53-targets';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct, IConstruct } from 'constructs';

/**
 * construct properties for EksUtils
 */
export interface MagentoServiceProps {
  /**
   * Vpc for the Service
   * @default - create a new VPC or use existing one
   */
  readonly vpc: IVpc;
  /**
   * Cluster ECS
   */
  readonly cluster: ICluster;

  /**
   * This is EC2 cluster or Fargate cluster
   */
  readonly ec2Cluster: boolean;
  readonly capacityProviderName: string;

  /*
   * magentoPassword
   */
  readonly magentoPassword: secretsmanager.Secret;
  /**
   *  Magento docker image
   *
   */
  readonly magentoImage: AssetImage;

  /**
   * Do we use EFS ?
   * useFSX and useEFS are exclusives
   */
  readonly useEFS: boolean;
  /**
   * Efs FileSystem to uses for the service
   */
  readonly efsFileSystem: FileSystem;

  /**
   * Efs AccessPoint to uses for the service
   */
  readonly fileSystemAccessPoint: AccessPoint;
  /**
   * Do we use FsX ONTAP ?
   * useFSX and useEFS are exclusives
   */
  readonly useFSX: boolean;

  /**
   * Database Cluster
   */
  readonly db: IDatabaseCluster;

  /**
   * Database User
   */
  readonly dbUser: string;

  /**
   * Database Name
   */
  readonly dbName: string;

  /**
   * Database Password
   */

  readonly dbPassword: secretsmanager.Secret;

  /**
   * OpenSearch Domain
   */
  readonly osDomain: IDomain;

  /**
   * OpenSearch User
   */
  readonly osUser: string;

  /*
   * magento Opensearch Admin Password
   */
  readonly osPassword: secretsmanager.Secret;
  //readonly osPassword: string;

  /*
   * Service Security Group
   */
  readonly serviceSG: ISecurityGroup;

  /**
   * KMS Key to encrypt SSM sessions and bucket
   * @default - public.ecr.aws/d7p2r8s3/apisix
   */
  readonly kmsKey: Key;

  /**
   * Bucket to store ecs exec commands
   * @default -
   */
  readonly execBucket: Bucket;

  /**
   * Log group to log ecs exec commands
   * @default - '/ecs/secu/exec/' + cluster.clusterName,
   */
  readonly execLogGroup: LogGroup;

  /*
   ** admin specify if we start admin magento service used to bootstrap magento with with `MAGENTO_DEPLOY_STATIC_CONTENT=yes`, `MAGENTO_SKIP_REINDEX=no`, `MAGENTO_SKIP_BOOTSTRAP=no`
   ** @default true
   */
  readonly magentoAdminTask?: Boolean;

  /*
   ** adminDebug specify if we cxreate a service with empty command to not start magento process and allow ecs connect in it
   ** @default false
   */
  readonly magentoAdminTaskDebug?: Boolean;

  /*
   ** mainStackALB is the ALB define in the main stack for magento (not the admin one)
   ** @default none
   */
  readonly mainStackALB?: ApplicationLoadBalancer;

  /*
   ** Elasticache Redis Endpoint Address
   ** @default none
   */

  readonly cacheEndpoint?: String;
}

/*
 ** //https://docs.aws.amazon.com/cdk/api/latest/docs/aws-ecs-readme.html
 */
export class MagentoService extends Construct {
  readonly service!: FargateService | Ec2Service;
  readonly alb!: ApplicationLoadBalancer;
  readonly hostName!: string;
  getService() {
    return this.service;
  }
  getALB() {
    return this.alb;
  }

  constructor(scope: Construct, id: string, props: MagentoServiceProps) {
    super(scope, id);

    const stack = Stack.of(this);

    /*
     ** If we provide var in context route53_domain_zone, then we want to uses this hostedzone to expose our app.
     ** else, we are only going to leverage default load balancer DNS name.
     */
    // Lookup pre-existing TLS certificate for our magento service:
    const r53DomainZone = this.node.tryGetContext('route53_domain_zone');
    if (!r53DomainZone) {
      console.log(
        'Consider specifying r53DomainZoneparameter to work securely in TLS, you need to provide valid route53 domain',
      );
    }

    /**
     * create ALB
     */
    const albName = 'ecs-' + props.cluster.clusterName + id;
    if (!props.magentoAdminTask) {
      this.alb = new ApplicationLoadBalancer(this, id + 'ALB', {
        vpc: props.vpc,
        internetFacing: true,
        loadBalancerName: albName,
      });

      Tags.of(this.alb).add('Name', albName);
    }

    var certificate = undefined;
    var domainZone = undefined;
    var listener = undefined;
    // If we define a route53 hosted zone, we setup also SSL and certificate
    if (r53DomainZone != undefined) {
      const r53MagentoPrefix = this.node.tryGetContext('route53_magento_prefix')
        ? this.node.tryGetContext('route53_magento_prefix')
        : stack.stackName;
      const certificateArn = StringParameter.fromStringParameterAttributes(this, 'CertArnParameter', {
        parameterName: 'CertificateArn-' + r53DomainZone,
      }).stringValue;
      certificate = Certificate.fromCertificateArn(this, 'ecsCert', certificateArn);
      domainZone = HostedZone.fromLookup(this, 'Zone', { domainName: r53DomainZone });
      this.hostName = r53MagentoPrefix + '.' + r53DomainZone;

      if (!props.magentoAdminTask) {
        listener = this!.alb.addListener(id + 'Listener', { port: 443 });

        listener.addCertificates(id + 'cert', [certificate]);
        new ARecord(this, id + 'AliasRecord', {
          zone: domainZone,
          recordName: r53MagentoPrefix + '.' + r53DomainZone,
          target: RecordTarget.fromAlias(new LoadBalancerTarget(this!.alb)),
        });
        new CfnOutput(this, id + 'URL', { value: 'https://' + this.hostName });
      }
    } else {
      //if no route53 we will run in http mode on default LB domain name
      if (!props.magentoAdminTask) {
        listener = this!.alb.addListener(id + 'Listener', { port: 80 });
        this.hostName = this!.alb.loadBalancerDnsName;
        new CfnOutput(this, id + 'URL', { value: 'http://' + this.hostName });
      } else {
        this.alb = props.mainStackALB!;
        this.hostName = this!.alb.loadBalancerDnsName;
      }
    }

    const taskCpu = this.node.tryGetContext('taskCpu') || 2048;
    const taskMem = this.node.tryGetContext('taskMem') || 8192;
    const phpMemoryLimit = this.node.tryGetContext('phpMemoryLimit') || '7G';

    let taskDefinition: Ec2TaskDefinition | FargateTaskDefinition;
    if (props.ec2Cluster) {
      taskDefinition = new Ec2TaskDefinition(this, 'TaskDef' + id, {
        networkMode: NetworkMode.AWS_VPC,
      });
    } else {
      //Need to respect valid cpu/memory Fargate options: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-cpu-memory-error.html
      taskDefinition = new FargateTaskDefinition(this, 'TaskDef' + id, {
        cpu: taskCpu,
        memoryLimitMiB: taskMem,
      });
    }
    if (props.useFSX) {
      taskDefinition.addVolume({
        name: 'MagentoFsxVolume',
        host: {
          sourcePath: '/mnt/fsx',
        },
      });
    } else if (props.useEFS && props.efsFileSystem) {
      taskDefinition.addVolume({
        name: 'MagentoEfsVolume',
        efsVolumeConfiguration: {
          fileSystemId: props.efsFileSystem.fileSystemId,
          transitEncryption: 'ENABLED',
          authorizationConfig: {
            accessPointId: props.fileSystemAccessPoint!.accessPointId,
          },
        },
      });
    }
    const magentoUser = this.node.tryGetContext('magento_user') ? this.node.tryGetContext('magento_user') : 'magento';

    const magentoEnvs: {[key: string]: string} = {
      BITNAMI_DEBUG: 'true',
      MAGENTO_USERNAME: magentoUser,

      //Only configure on Admin task
      MAGENTO_ADMIN_TASK: props.magentoAdminTask ? 'yes' : 'no',
      MAGENTO_DEPLOY_STATIC_CONTENT: props.magentoAdminTask ? 'yes' : 'no',
      MAGENTO_SKIP_REINDEX: props.magentoAdminTask ? 'no' : 'yes',
      MAGENTO_SKIP_BOOTSTRAP: props.magentoAdminTask ? 'no' : 'yes',
      MAGENTO_EXTRA_INSTALL_ARGS: `--cache-backend=redis --cache-backend-redis-server=${props.cacheEndpoint} --cache-backend-redis-port=6379 --cache-backend-redis-db=0 --session-save=redis --session-save-redis-host=${props.cacheEndpoint} --session-save-redis-db=2`,

      MAGENTO_HOST: this!.hostName,
      MAGENTO_ENABLE_HTTPS: r53DomainZone ? 'yes' : 'no',
      MAGENTO_ENABLE_ADMIN_HTTPS: r53DomainZone ? 'yes' : 'no',
      MAGENTO_MODE: 'production',
      //Do we use Shared File System ? need to now for entrypoint script
      MAGENTO_USE_FS: props.useEFS || props.useFSX ? 'yes' : 'no',

      MAGENTO_DATABASE_HOST: props.db.clusterEndpoint.hostname,
      MAGENTO_DATABASE_PORT_NUMBER: '3306',
      MAGENTO_DATABASE_USER: props.dbUser,
      MAGENTO_DATABASE_NAME: props.dbName,

      ELASTICSEARCH_HOST: props.osDomain.domainEndpoint,
      ELASTICSEARCH_PORT_NUMBER: '443',
      MAGENTO_ELASTICSEARCH_USE_HTTPS: 'yes',
      MAGENTO_ELASTICSEARCH_ENABLE_AUTH: 'yes',
      MAGENTO_ELASTICSEARCH_USER: props.osUser,

      PHP_MEMORY_LIMIT: phpMemoryLimit,
    };
    const magentoMarketplaceSecrets = secretsmanager.Secret.fromSecretNameV2(
      this,
      id + 'magento-secrets',
      'MAGENTO_MARKETPLACE',
    );

    const magentoSecrets = {
      MAGENTO_PASSWORD: ecs.Secret.fromSecretsManager(props.magentoPassword),
      MAGENTO_DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(props.dbPassword),
      MAGENTO_ELASTICSEARCH_PASSWORD: ecs.Secret.fromSecretsManager(props.osPassword),

      //Create secrets to access Magento Repo for packages
      MAGENTO_MARKETPLACE_PUBLIC_KEY: ecs.Secret.fromSecretsManager(magentoMarketplaceSecrets, 'public-key'),
      MAGENTO_MARKETPLACE_PRIVATE_KEY: ecs.Secret.fromSecretsManager(magentoMarketplaceSecrets, 'private-key'),
    };

    var containerDef: ContainerDefinitionOptions = {
      containerName: 'magento',
      image: props.magentoImage,
      command: props.magentoAdminTask == true && props.magentoAdminTaskDebug ? ['tail', '-f', '/dev/null'] : undefined,
      logging: new AwsLogDriver({
        streamPrefix: 'service',
        mode: AwsLogDriverMode.NON_BLOCKING,
      }),
      environment: magentoEnvs,
      secrets: magentoSecrets,
      user: 'daemon',
      cpu: taskCpu,
      memoryLimitMiB: taskMem,
    };
    const container = taskDefinition.addContainer('magento', containerDef);

    container.addPortMappings({
      containerPort: 8080,
    });
    // TODO - The best way to handle this by having /bitnami/magento/var/pub/media mount
    if (props.useFSX) {
      container.addMountPoints({
        readOnly: false,
        containerPath: '/bitnami/magento',
        sourceVolume: 'MagentoFsxVolume',
      });
    } else if (props.useEFS) {
      container.addMountPoints({
        readOnly: false,
        containerPath: '/bitnami/magento',
        sourceVolume: 'MagentoEfsVolume',
      });
    }

    //container.addToExecutionPolicy(
    taskDefinition.addToExecutionRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        resources: ['*'],
        actions: [
          'ecr:GetAuthorizationToken',
          'ecr:BatchCheckLayerAvailability',
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchGetImage',
        ],
      }),
    );

    if (props.useEFS && props.efsFileSystem) {
      taskDefinition.addToExecutionRolePolicy(
        new PolicyStatement({
          actions: ['elasticfilesystem:ClientMount', 'elasticfilesystem:ClientWrite'],
          resources: [
            stack.formatArn({
              service: 'elasticfilesystem',
              resource: 'file-system',
              //sep: '/',
              resourceName: props.efsFileSystem!.fileSystemId,
            }),
          ],
        }),
      );
    }

    /*
     * Add metrics sidecar
     * TODO: add metrics sidecar
     */
    //  taskDefinition.addContainer('Sidecar', {
    //    image: ecs.ContainerImage.fromRegistry('example/metrics-sidecar'),
    //  });

    /*
     * Create service
     */
    var cluster = props.cluster;

    if (props.ec2Cluster) {
      //No Load Balancer for Admin Service
      this.service = new Ec2Service(this, 'Service' + id, {
        cluster,
        serviceName: id, // when specifying service name, this prevent CDK to apply change to existing service, change the name if you need to perform updates, and change it back to original to keep Dashboard working
        taskDefinition: taskDefinition,
        securityGroups: [props.serviceSG],
        enableExecuteCommand: true,
        capacityProviderStrategies: [
          {
            capacityProvider: props.capacityProviderName,
            weight: 100,
          },
        ],
        healthCheckGracePeriod: !props.magentoAdminTask ? Duration.minutes(2) : undefined, // CreateService error: Health check grace period is only valid for services configured to use load balancers
      });

      /**
       * Bug: can't delete Capacity provider
       * https://github.com/aws/aws-cdk/issues/19275
       * Add a dependency from capacity provider association to the cluster
       * and from each service to the capacity provider association.
       */
      class CapacityProviderDependencyAspect implements IAspect {
        public visit(node: IConstruct): void {
          if (node instanceof ecs.Ec2Service) {
            const children = node.cluster.node.findAll();
            for (const child of children) {
              if (child instanceof ecs.CfnClusterCapacityProviderAssociations) {
                child.node.addDependency(node.cluster);
                node.node.addDependency(child);
              }
            }
          }
        }
      }
      Aspects.of(this).add(new CapacityProviderDependencyAspect());

      // Specify binpack by memory and spread across availability zone as placement strategies.
      // To place randomly, call: service.placeRandomly()
      if (!props.magentoAdminTask) {
        (this.service as ecs.Ec2Service).addPlacementStrategies(
          ecs.PlacementStrategy.packedByMemory(),
          ecs.PlacementStrategy.packedByCpu(),
          ecs.PlacementStrategy.spreadAcross(ecs.BuiltInAttributes.AVAILABILITY_ZONE),
        );
      }
    } else {
      // Fargate Cluster
      //No Load Balancer for Admin Service
      this.service = new FargateService(this, 'Service' + id, {
        cluster,
        serviceName: id, // when specifying service name, this prevent CDK to apply change to existing service Resource of type 'AWS::ECS::Service' with identifier 'eksutils' already exists.
        taskDefinition: taskDefinition,
        platformVersion: FargatePlatformVersion.VERSION1_4,
        securityGroups: [props.serviceSG],
        enableExecuteCommand: true,
        healthCheckGracePeriod: !props.magentoAdminTask ? Duration.minutes(2) : undefined, // CreateService error: Health check grace period is only valid for services configured to use load balancers
      });
    }

    new CfnOutput(stack, 'EcsExecCommand' + id, {
      value: `ecs_exec_service ${cluster.clusterName} ${this.service.serviceName} ${taskDefinition.defaultContainer?.containerName}`,
    });

    if (!props.magentoAdminTask) {
      const target = listener!.addTargets(id + 'Targets', {
        port: 8080,
        targets: [
          this.service.loadBalancerTarget({
            containerName: 'magento',
            containerPort: 8080,
          }),
        ],
        healthCheck: {
          healthyThresholdCount: 2, // Min 2
          unhealthyThresholdCount: 10, // MAx 10
          timeout: Duration.seconds(30),
          interval: Duration.seconds(40),
          healthyHttpCodes: '200-499',
          path: '/',
        },
        deregistrationDelay: Duration.minutes(5),
      });

      const magentoMinTasks = this.node.tryGetContext('magentoMinTasks') || 1;
      const magentoMaxTasks = this.node.tryGetContext('magentoMinTasks') || 30;
      const targetCpuScaling = this.node.tryGetContext('targetCpuScaling') || 60;
      const targetMemScaling = this.node.tryGetContext('targetMemScaling') || 60;

      const scalableTarget = this.service.autoScaleTaskCount({
        minCapacity: magentoMinTasks,
        maxCapacity: magentoMaxTasks,
      });

      scalableTarget.scaleOnCpuUtilization('CpuScaling', {
        targetUtilizationPercent: targetCpuScaling,
        scaleOutCooldown: Duration.seconds(10),
        scaleInCooldown: Duration.seconds(10),
        disableScaleIn: false,
      });

      scalableTarget.scaleOnMemoryUtilization('MemoryScaling', {
        targetUtilizationPercent: targetMemScaling,
        scaleOutCooldown: Duration.seconds(10),
        scaleInCooldown: Duration.seconds(10),
        disableScaleIn: false,
      });

      // scalableTarget.scaleOnRequestCount('RequestScaling', {
      //   requestsPerTarget: 50,
      //   scaleOutCooldown: Duration.seconds(10),
      //   scaleInCooldown: Duration.seconds(120),
      //   targetGroup: target,
      // });
      target;

      //TODO : Scalable target on schedule
      //Invalid schedule expression. Details: Schedule expressions must have the following syntax: rate(<number>\s?(minutes?|hours?|days?)), cron(<cron_expression>) or at(yyyy-MM-dd'T'HH:mm:ss). (Service: AWSApplicationAutoScaling;

      // scalableTarget.scaleOnSchedule('DaytimeScaleDown', {
      //   schedule: Schedule.cron({ hour: '19', minute: '0' }),
      //   minCapacity: 1,
      // });

      // scalableTarget.scaleOnSchedule('EveningRushScaleUp', {
      //   schedule: Schedule.cron({ hour: '8', minute: '0' }),
      //   minCapacity: 10,
      // });
    }

    new CfnOutput(this, 'magentoURL', { value: 'https://' + this!.hostName });
  }
}
