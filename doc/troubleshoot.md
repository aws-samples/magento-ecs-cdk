# Troubleshooting

### Connect to the Magento Admin Task

If you activate the context parameter `magento_admin_task` then the Stack creates a dedicated Service that is deployed with all same parameters as the Magento task, except that it don't get exposed through a load balancer, But is linked with the same, DB, same Opensearch, and the same Elastic Fils system or FsX ONTAP...
If you activate the context parameter `magento_admin_task` then, the Admin task actually do nothing, letting you to exec into it and configure manually magento as you need.

> You can use the Admin task to interact with your Magento setup or debug things.
> The CDK stack correctly configures the tasks so that you can securely connect inside.

The CloudFomation Output shows you some commands so that you can directly use to exec inside your tasks.
the Makefile can also show you these commands:

```bash
make connect
```

The printed commands can be used to exec into your containers. It uses a helper function that you can put in your PATH or simply source the file:

```bash
source src/helper.sh
ecs_exec_service magento MagentoServiceDebug magento
```

> In case of errors during the connection, you still can use [ecs-exec-checker](https://github.com/aws-containers/amazon-ecs-exec-checker) tool to figure out where the problem is.

### Troubleshoot first install

The bootstrapping of Magento is done with 2 steps:

1. The MagentoServiceAdmin tasks needs to do the bootstrap, and execute the `docker-entrypoint-init.d/01-install-sample-data.sh` script.
   1. when finished it will create a specific file `/bitnami/magento/__INIT_IS_OK__` on the shared file system (EFS or FsX)
2. The MagentoService tasks will not boot until the specific file exists
   1. Once the file exists, magento will start on MagentoService tasks.

When Magento starts, it will execute the following command this must be done using the `daemon` user.:

```bash
su daemon -s /bin/bash
/opt/bitnami/scripts/magento/entrypoint.sh /opt/bitnami/scripts/magento/run.sh
```

If the Task didn't start properly, you can exec into the MagentoServiceAdmin task and manually execute the previous command to help figure out where the problem is.

- This can be Magento Marketplace credentials issues
- This can be bad ElasticSearch passwords format 
- This can be many things..

  ```
  In SearchConfig.php line 81:

    Could not validate a connection to Elasticsearch. Could not parse URI: "htt
    ps://magento-master-os:beavqpdh.Kzm4?6WqtJHv4e0Lj3AioyI@search-magento-zwa5
    v3x4br3kgn4y5e5nu6hv7q.eu-west-1.es.amazonaws.com:443"
  ```

> If there was a bootstrap error and the specific file `/bitnami/magento/__INIT_IS_OK__` was created, you may need to manually delete it so the bootstrap process can try again.

### Debug Magento Apache configuration

Check Magento config:

```
php bin/magento config:show
```

Configuration files are :

```
# /opt/bitnami/apache/conf/httpd.conf
# /opt/bitnami/apache/conf/extra/httpd-default.conf
# /opt/bitnami/apache/conf/vhosts/*.conf
# /opt/bitnami/apache/conf/bitnami/bitnami.conf
# /opt/bitnami/apache/conf/bitnami/php.conf
# /opt/bitnami/magento/app/etc/env.php
```

### Magento Erros logs

If you get an error in magento, you can find corresponding log in

```
/bitnami/magento/var/report/<error_id>
```

If the error is like

```
{"0":"Unable to retrieve deployment version of static files from the file system."
...
```

Generally a solution for that is to rebuild some commands:

Connect to MagentoServiceAdmin Task, and execute the following commands in it

```
$ source src/helper.sh
$ ecs_exec_service magento MagentoServiceDebug magento
root@ip-10-0-155-249:/# su daemon -s /bin/bash
root@ip-10-0-155-249:/# cd /bitnami/magento
root@ip-10-0-155-249:/# php -d memory_limit=-1 bin/magento setup:upgrade
root@ip-10-0-155-249:/# php -d memory_limit=-1 bin/magento setup:static-content:deploy -f
root@ip-10-0-155-249:/# php -d memory_limit=-1 bin/magento cache:flush
```

You may also need to rebuild your cache with the crawler.

### Mysql

You can connect to the Mysql DB from magento asks:

```
mysql -h $MAGENTO_DATABASE_HOST -u $MAGENTO_DATABASE_USER -p$MAGENTO_DATABASE_PASSWORD $MAGENTO_DATABASE_NAME
```

## Elasticsearch

You can test the OpenSearch connection with curl:

```
curl -XPOST -u "$MAGENTO_ELASTICSEARCH_USER:$MAGENTO_ELASTICSEARCH_PASSWORD" "https://$ELASTICSEARCH_HOST/_search" -H "content-type:application/json" -d'
{
"query": {
"match_all": {}
}
}'
```

### Deleting the Stack

The stack is configured to delete the database cluster and OpenSearch cluster, and EFS file system. If you want to be able to keep the data, you will need to update the **removalPolicy** policies of those services in the CDK code.

```typescript
    const db = new DatabaseCluster(this, 'ServerlessWordpressAuroraCluster', {
      engine: DatabaseClusterEngine.AURORA_MYSQL,
      credentials: Credentials.fromPassword(DB_USER, secret),
      removalPolicy: RemovalPolicy.DESTROY, // <-- you can change this ----------------------------->
      instanceProps: {
        vpc: vpc,
        securityGroups: [rdsSG],
      },
      defaultDatabaseName: DB_NAME,
    });
    ...

    const osDomain = new opensearch.Domain(this, 'Domain', {
      version: opensearch.EngineVersion.OPENSEARCH_1_0,
      domainName: OS_DOMAIN,
      //accessPolicies: [osPolicy], // Default No access policies
      removalPolicy: RemovalPolicy.DESTROY, // <-- you can change this ---------------------------->
      securityGroups: [openSearchSG],
    ...

    const efsFileSystem = new FileSystem(this, 'FileSystem', {
      vpc,
      securityGroup: efsFileSystemSecurityGroup,
      performanceMode: PerformanceMode.GENERAL_PURPOSE,
      lifecyclePolicy: LifecyclePolicy.AFTER_30_DAYS,
      throughputMode: ThroughputMode.BURSTING,
      encrypted: true,
      removalPolicy: RemovalPolicy.DESTROY,// <-- you can change this ---------------------------->
    });
```

While we can't delete an ECS Capacity Provider when associated Autoscaling Group still exists, the first attempt to delete the stack may be finished in a `DELETE_FAILED` state. A second delete attempt should properly delete everything.
