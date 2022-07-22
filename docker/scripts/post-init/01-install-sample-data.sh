#!/bin/bash


install_sample(){
    # chown -R daemon:daemon /bitnami/magento/
  echo "*Enabling Maintenance Mode*"
  bin/magento maintenance:enable
  echo "**Installing Sample Application"
  # php bin/magento config:set dev/js/minify_files 1
  # php bin/magento config:set dev/css/minify_files 1
  # php bin/magento config:set dev/js/enable_js_bundling 1
  # php bin/magento config:set dev/css/merge_css_files 1
  # php bin/magento config:set dev/static/sign 1
  # php bin/magento config:set dev/js/minify_files 1
  echo "**Installing Sample Application - setup:upgrade"
  php -d memory_limit=-1 bin/magento setup:upgrade
  echo "**Installing Sample Application - sampledata:deploy"
  php -d memory_limit=-1 bin/magento sampledata:deploy
  echo "**Installing Sample Application - setup:static-content:deploy -f"
  php -d memory_limit=-1 bin/magento setup:static-content:deploy -f
  echo "**Installing Sample Application - indexer:reindex"
  php -d memory_limit=-1 bin/magento indexer:reindex
  echo "**Installing Sample Application - catalog:image:resize"
  php -d memory_limit=-1 bin/magento catalog:image:resize
  echo "**Installing Sample Application - cache:flush"
  php -d memory_limit=-1 bin/magento cache:flush
  echo "*disabling maintenance mode*"
  bin/magento maintenance:disable
}
# Install Magento sample datas.
#su daemon -s /bin/bash
if [[ "$MAGENTO_ADMIN_TASK" = "yes" && ! -f /bitnami/magento/__INIT_IS_OK__ ]]; then
  echo "--- STARTING INIT ---"
  cd /bitnami/magento

  echo "**update magento credentials"
    #TODO: do it only on Admin ?
    cd /bitnami/magento
    mkdir -p /bitnami/magento/var/composer_home/
    cat <<END > /bitnami/magento/var/composer_home/auth.json
{
    "http-basic": {
        "repo.magento.com": {
            "username": "$MAGENTO_MARKETPLACE_PUBLIC_KEY",
            "password": "$MAGENTO_MARKETPLACE_PRIVATE_KEY"
        }
    }
}
END


  echo "*Install 1*"
  install_sample

  echo "*writing INIT result file*"
  touch /bitnami/magento/__INIT_IS_OK__
else
  echo "--- STARTING DO NOTHING ---"
fi

if [[ "$MAGENTO_ADMIN_TASK" = "yes" ]]; then
  echo "Ensure all is good for magento"
  php -d memory_limit=-1 bin/magento setup:upgrade
  php -d memory_limit=-1 bin/magento setup:static-content:deploy -f
  php -d memory_limit=-1 bin/magento cache:flush
fi