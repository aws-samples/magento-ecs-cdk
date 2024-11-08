#!/bin/bash

# shellcheck disable=SC1091

set -o errexit
set -o nounset
set -o pipefail
# set -o xtrace # Uncomment this line for debugging purpose



# Load Magento environment
. /opt/bitnami/scripts/magento-env.sh

# Load libraries
. /opt/bitnami/scripts/libbitnami.sh
. /opt/bitnami/scripts/liblog.sh
. /opt/bitnami/scripts/libwebserver.sh

print_welcome_page

if [[ "$MAGENTO_ADMIN_TASK" = "no" && ! -f /bitnami/magento/__INIT_IS_OK__ ]]; then
  while [ ! -f /bitnami/magento/__INIT_IS_OK__ ]; do
    info "** Magento Still not Initialised, Waiting**"
    sleep 60
  done
fi

if [[ "$1" = "/opt/bitnami/scripts/magento/run.sh" || "$1" = "/opt/bitnami/scripts/$(web_server_type)/run.sh" || "$1" = "/opt/bitnami/scripts/nginx-php-fpm/run.sh" ]]; then
    info "** Starting Magento setup **"
    /opt/bitnami/scripts/"$(web_server_type)"/setup.sh
    info "** Starting Magento setup php**"
    /opt/bitnami/scripts/php/setup.sh
    info "** Starting Magento setup mysql**"
    /opt/bitnami/scripts/mysql-client/setup.sh


    info "** Fix Grant **"
    if [[ "$MAGENTO_ADMIN_TASK" = "yes" ]]; then
      # Wait for database to be ready (if necessary)
      until mysql -h $MAGENTO_DATABASE_HOST -u $MAGENTO_DATABASE_USER -p$MAGENTO_DATABASE_PASSWORD -e "SELECT 1"; do
        echo "Waiting for database connection..."
        sleep 5
      done

      # Now apply your GRANT privileges
      mysql -h $MAGENTO_DATABASE_HOST -u $MAGENTO_DATABASE_USER -p$MAGENTO_DATABASE_PASSWORD $MAGENTO_DATABASE_NAME <<EOF
      GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, ALTER, 
      CREATE TEMPORARY TABLES, LOCK TABLES, EXECUTE, CREATE VIEW, SHOW VIEW, 
      CREATE ROUTINE, ALTER ROUTINE, TRIGGER ON $MAGENTO_DATABASE_NAME.* 
      TO '$MAGENTO_DATABASE_USER'@'%';
      FLUSH PRIVILEGES;
EOF
    fi
    
    info "** Starting Magento magento **"
    #Accelerate the boot for additional tasks by disabling setup:upgrade
     if [[ "$MAGENTO_ADMIN_TASK" = "no" ]]; then
       sed -i 's/        info "Upgrading database schema"/        info "DISABLE Upgrading database schema"/' /opt/bitnami/scripts/libmagento.sh
       sed -i 's/        magento_execute setup:upgrade/        info "DISABLE Upgrading database schema" #magento_execute setup:upgrade/' /opt/bitnami/scripts/libmagento.sh
    fi
    
    /opt/bitnami/scripts/magento/setup.sh
    info "** Starting Magento post **"
    /post-init.sh
    info "** Magento setup finished! **"
fi

echo ""
exec "$@"